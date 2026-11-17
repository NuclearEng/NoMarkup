#!/usr/bin/env node
// Verification record: which checks actually ran, and on exactly which file
// contents, so a commit can be stamped `Verified-by:` from evidence instead of
// from what its author typed.
//
//   node scripts/verify-record.mjs run --label "<name>" [--cwd <dir>] -- <command...>
//       Runs the command. Only when it exits 0 AND the working tree is
//       unchanged by it, appends a record holding the git blob id of every
//       file that differs from HEAD (staged, unstaged or untracked).
//   node scripts/verify-record.mjs stamp <commit-msg-file>
//       Used by scripts/hooks/commit-msg. Removes any `Verified-by:` line the
//       author wrote and adds one trailer listing the recorded checks whose
//       file contents equal, for every staged path, what is being committed —
//       or `none`.
//   node scripts/verify-record.mjs show
//       Prints the records that cover the currently staged change.
//
// The record lives in the worktree's git dir (`git rev-parse --git-path
// verify-record.jsonl`), is never committed, and keeps the last 24 hours.

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const DELETED = 'deleted';

const git = (args, cwd, input) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });

const head = (repo) => {
  try {
    return git(['rev-parse', '--verify', '-q', 'HEAD'], repo).trim();
  } catch {
    return EMPTY_TREE;
  }
};

export const recordPath = (repo) => {
  const p = git(['rev-parse', '--git-path', 'verify-record.jsonl'], repo).trim();
  return isAbsolute(p) ? p : join(repo, p);
};

/** path -> blob id (or 'deleted') for every file that differs from HEAD in the working tree. */
export function workingFingerprint(repo) {
  const base = head(repo);
  const changed = git(['diff', '--name-only', '--no-renames', '-z', base], repo).split('\0').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], repo).split('\0').filter(Boolean);
  const paths = [...new Set([...changed, ...untracked])].sort();
  const files = {};
  const present = paths.filter((p) => existsSync(join(repo, p)));
  for (const p of paths) if (!present.includes(p)) files[p] = DELETED;
  if (present.length) {
    const ids = git(['hash-object', '--stdin-paths'], repo, `${present.join('\n')}\n`).trim().split('\n');
    present.forEach((p, i) => {
      files[p] = ids[i];
    });
  }
  return files;
}

/** path -> blob id (or 'deleted') for what the next commit will contain. */
export function stagedFingerprint(repo) {
  const out = git(['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z', head(repo)], repo);
  const parts = out.split('\0').filter(Boolean);
  const files = {};
  for (let i = 0; i + 1 < parts.length; i += 2) {
    // ":100644 100644 <old> <new> M" then the path
    const meta = parts[i].split(' ');
    const status = meta[4];
    files[parts[i + 1]] = status.startsWith('D') ? DELETED : meta[3];
  }
  return files;
}

const sameFiles = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

export function readRecords(repo, now = Date.now()) {
  const p = recordPath(repo);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((r) => r && typeof r.label === 'string' && r.files && now - Date.parse(r.ts) <= MAX_AGE_MS);
}

export function appendRecord({ repo, label, command, files = workingFingerprint(repo), now = new Date() }) {
  const rec = { ts: now.toISOString(), label, command, head: head(repo), files };
  const p = recordPath(repo);
  const kept = readRecords(repo, now.getTime()).map((r) => JSON.stringify(r));
  writeFileSync(p, kept.length ? `${kept.join('\n')}\n` : '');
  appendFileSync(p, `${JSON.stringify(rec)}\n`);
  return rec;
}

/** Labels of records whose observed content equals the staged content for every staged path. */
export function coveringLabels(repo, now = Date.now()) {
  const staged = stagedFingerprint(repo);
  const paths = Object.keys(staged);
  if (!paths.length) return [];
  const labels = [];
  for (const r of readRecords(repo, now)) {
    if (paths.every((p) => (r.files[p] ?? null) === staged[p]) && !labels.includes(r.label)) labels.push(r.label);
  }
  return labels;
}

/** Rewrite a commit message file with exactly one computed Verified-by trailer. */
export function stampMessage(repo, msgFile, now = Date.now()) {
  const labels = coveringLabels(repo, now);
  const value = labels.length ? labels.join('; ') : 'none';
  const original = readFileSync(msgFile, 'utf8');
  const cleaned = original
    .split('\n')
    .filter((l) => !/^verified-by:/i.test(l))
    .join('\n');
  writeFileSync(msgFile, cleaned);
  // --where start keeps existing trailers (Co-Authored-By) last.
  git(['interpret-trailers', '--in-place', '--where', 'start', '--if-exists', 'replace', '--trailer', `Verified-by: ${value}`, msgFile], repo);
  return value;
}

function main(argv) {
  const repo = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
  const [cmd, ...rest] = argv;
  if (cmd === 'run') {
    const sep = rest.indexOf('--');
    const opts = rest.slice(0, sep < 0 ? rest.length : sep);
    const command = sep < 0 ? [] : rest.slice(sep + 1);
    const li = opts.indexOf('--label');
    const ci = opts.indexOf('--cwd');
    const label = li >= 0 ? opts[li + 1] : null;
    const cwd = ci >= 0 ? resolve(repo, opts[ci + 1]) : process.cwd();
    if (!label || !command.length) {
      process.stderr.write('usage: verify-record.mjs run --label "<name>" [--cwd <dir>] -- <command...>\n');
      return 2;
    }
    const before = workingFingerprint(repo);
    const res = spawnSync(command[0], command.slice(1), { cwd, stdio: 'inherit' });
    if (res.error) {
      process.stderr.write(`verify-record: ${res.error.message}\n`);
      return 127;
    }
    if (res.status !== 0) {
      process.stderr.write(`verify-record: "${label}" failed (exit ${res.status}); not recorded\n`);
      return res.status ?? 1;
    }
    const after = workingFingerprint(repo);
    if (!sameFiles(before, after)) {
      process.stderr.write(`verify-record: "${label}" passed but changed the working tree; not recorded — review the change and run it again\n`);
      return 0;
    }
    appendRecord({ repo, label, command: command.join(' '), files: after });
    process.stderr.write(`verify-record: recorded "${label}"\n`);
    return 0;
  }
  if (cmd === 'stamp') {
    if (!rest[0]) {
      process.stderr.write('usage: verify-record.mjs stamp <commit-msg-file>\n');
      return 2;
    }
    stampMessage(repo, rest[0]);
    return 0;
  }
  if (cmd === 'show') {
    const labels = coveringLabels(repo);
    process.stdout.write(labels.length ? `${labels.join('\n')}\n` : 'none (no recorded check covers the staged change)\n');
    return 0;
  }
  process.stderr.write('usage: verify-record.mjs <run|stamp|show> ...\n');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
