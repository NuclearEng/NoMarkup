#!/usr/bin/env node
// Diff-triggered reliability checklist (docs/reliability-checklist.md).
//
// Prints only the checklist items whose trigger matches the current diff
// (committed + staged + unstaged + untracked changes since the merge base with
// --base, default origin/main) and, with --run, executes the automatable ones.
//
//   node scripts/reliability-check.mjs [--base <ref>] [--run] [--record] [--all]
//                                      [--json] [--checklist <file>] [--repo <dir>]
//                                      [--summary <file>]
//
// Exit codes: 0 = no automated check failed, 1 = an automated check failed,
// 2 = usage error / unparseable checklist / no merge base.

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { collectDiff, git, pathMatches } from './reliability/lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIELDS = new Set(['Paths', 'Added', 'Removed', 'Status', 'Check', 'Run', 'Source']);
const STATUSES = new Set(['added', 'modified', 'deleted', 'renamed']);

const ticks = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/**
 * Parse the checklist markdown into items. Throws on a malformed item so a
 * broken edit fails loudly instead of silently dropping checks.
 */
export function parseChecklist(md) {
  const items = [];
  const errors = [];
  let cur = null;
  let field = null;
  const finish = () => {
    if (!cur) return;
    if (!cur.paths.length && !cur.added.length && !cur.removed.length) errors.push(`${cur.id}: needs Paths, Added or Removed`);
    if (!cur.check) errors.push(`${cur.id}: missing Check`);
    if (!cur.source) errors.push(`${cur.id}: missing Source`);
    items.push(cur);
  };
  for (const line of md.split('\n')) {
    const head = /^### (RC-\d+)\s*[·:—-]\s*(.+?)\s*$/.exec(line);
    if (head) {
      finish();
      cur = { id: head[1], title: head[2], paths: [], added: [], removed: [], status: [], check: '', run: [], source: '' };
      field = null;
      continue;
    }
    if (!cur) continue;
    if (/^#{1,3} /.test(line) || line.startsWith('---')) {
      finish();
      cur = null;
      field = null;
      continue;
    }
    const f = /^- \*\*(\w+):\*\*\s*(.*)$/.exec(line);
    if (f) {
      field = f[1];
      if (!FIELDS.has(field)) {
        errors.push(`${cur.id}: unknown field ${field}`);
        continue;
      }
      take(cur, field, f[2], errors);
      continue;
    }
    if (field && /^\s{2,}\S/.test(line)) take(cur, field, line.trim(), errors);
  }
  finish();
  const ids = new Set();
  for (const it of items) {
    if (ids.has(it.id)) errors.push(`${it.id}: duplicate id`);
    ids.add(it.id);
  }
  if (errors.length) throw new Error(`checklist does not parse:\n  ${errors.join('\n  ')}`);
  return items;
}

function take(item, field, text, errors) {
  switch (field) {
    case 'Paths':
      item.paths.push(...ticks(text));
      break;
    case 'Added':
    case 'Removed':
      for (const src of ticks(text)) {
        try {
          item[field.toLowerCase()].push(new RegExp(src));
        } catch (e) {
          errors.push(`${item.id}: bad ${field} regex ${src}: ${e.message}`);
        }
      }
      break;
    case 'Status':
      for (const s of ticks(text)) {
        if (!STATUSES.has(s)) errors.push(`${item.id}: unknown Status ${s}`);
        item.status.push(s);
      }
      break;
    case 'Run':
      item.run.push(...ticks(text));
      break;
    case 'Check':
      item.check = item.check ? `${item.check} ${text}` : text;
      break;
    case 'Source':
      item.source = item.source ? `${item.source} ${text}` : text;
      break;
    default:
      break;
  }
}

/**
 * Which items the diff triggers. `files` are {path, oldPath, status, added, removed}.
 * Returns [{item, files: [path], lines: count}] — never the line text itself.
 */
export function matchItems(items, files) {
  const out = [];
  for (const item of items) {
    const candidates = files.filter(
      (f) =>
        (pathMatches(item.paths, f.path) || (f.oldPath && pathMatches(item.paths, f.oldPath))) &&
        (!item.status.length || item.status.includes(f.status)),
    );
    if (!candidates.length) continue;
    if (!item.added.length && !item.removed.length) {
      out.push({ item, files: candidates.map((f) => f.path), lines: 0 });
      continue;
    }
    const hitFiles = [];
    let lines = 0;
    for (const f of candidates) {
      let n = 0;
      for (const { text } of f.added ?? []) if (item.added.some((re) => re.test(text))) n += 1;
      for (const { text } of f.removed ?? []) if (item.removed.some((re) => re.test(text))) n += 1;
      if (n) {
        hitFiles.push(f.path);
        lines += n;
      }
    }
    if (hitFiles.length) out.push({ item, files: hitFiles, lines });
  }
  return out;
}

function runCommand(cmd, { repo, env }) {
  const res = spawnSync('bash', ['-c', cmd], { cwd: repo, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`.trimEnd();
  return { cmd, ok: res.status === 0, status: res.status, output };
}

function parseArgs(argv) {
  const opts = { base: process.env.RC_BASE || 'origin/main', run: false, record: false, all: false, json: false, checklist: null, repo: null, summary: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${a} needs a value`);
      return argv[i];
    };
    if (a === '--base') opts.base = val();
    else if (a === '--run') opts.run = true;
    else if (a === '--record') opts.record = opts.run = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--checklist') opts.checklist = val();
    else if (a === '--repo') opts.repo = val();
    else if (a === '--summary') opts.summary = val();
    else if (a === '-h' || a === '--help') opts.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

const short = (s, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function main(argv, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    io.err(`${e.message}\n`);
    return 2;
  }
  if (opts.help) {
    io.out(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 13).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
    return 0;
  }
  const repo = resolve(opts.repo ?? git(['rev-parse', '--show-toplevel'], process.cwd()).trim());
  const checklistPath = resolve(opts.checklist ?? join(repo, 'docs/reliability-checklist.md'));

  let items;
  try {
    items = parseChecklist(readFileSync(checklistPath, 'utf8'));
  } catch (e) {
    io.err(`${e.message}\n`);
    return 2;
  }

  let diff;
  try {
    diff = collectDiff({ cwd: repo, base: opts.base });
  } catch (e) {
    io.err(`${e.message}\n`);
    return 2;
  }

  const matches = opts.all ? items.map((item) => ({ item, files: [], lines: 0 })) : matchItems(items, diff.files);

  const results = [];
  if (opts.run) {
    const changedFile = join(mkdtempSync(join(tmpdir(), 'rc-')), 'changed.txt');
    writeFileSync(changedFile, diff.files.map((f) => f.path).join('\n'));
    const env = { ...process.env, RC_TOOLS: join(HERE, 'reliability'), RC_BASE: diff.mergeBase, RC_CHANGED_FILE: changedFile };
    const done = new Map();
    for (const m of matches) {
      for (const cmd of m.item.run) {
        if (!done.has(cmd)) done.set(cmd, runCommand(cmd, { repo, env }));
        results.push({ id: m.item.id, ...done.get(cmd) });
      }
    }
  }
  const failed = results.filter((r) => !r.ok);

  if (opts.json) {
    io.out(`${JSON.stringify({
      base: opts.base,
      mergeBase: diff.mergeBase,
      changedFiles: diff.files.length,
      items: matches.map((m) => ({ id: m.item.id, title: m.item.title, check: m.item.check, source: m.item.source, run: m.item.run, files: m.files, lines: m.lines })),
      results: results.map(({ id, cmd, ok, status }) => ({ id, cmd, ok, status })),
    }, null, 2)}\n`);
  } else {
    const lines = [];
    lines.push(`Reliability checklist: ${matches.length} of ${items.length} items triggered by ${diff.files.length} changed file(s) since ${opts.base} (${diff.mergeBase.slice(0, 8)})`);
    for (const m of matches) {
      lines.push('');
      lines.push(`${m.item.id}  ${m.item.title}`);
      if (m.files.length) lines.push(`  triggered by: ${short(m.files.slice(0, 4).join(', ') + (m.files.length > 4 ? ` (+${m.files.length - 4} more)` : ''))}${m.lines ? `  [${m.lines} matching line(s)]` : ''}`);
      lines.push(`  check: ${m.item.check}`);
      if (m.item.run.length) lines.push(`  automated: ${m.item.run.join(' ; ')}`);
      lines.push(`  source: ${m.item.source}`);
    }
    if (opts.run) {
      lines.push('');
      if (!results.length) lines.push('No automated checks among the triggered items.');
      const seen = new Set();
      for (const r of results) {
        if (seen.has(r.cmd)) continue;
        seen.add(r.cmd);
        lines.push(`${r.ok ? 'PASS' : 'FAIL'}  ${r.cmd}`);
        if (!r.ok && r.output) lines.push(...r.output.split('\n').slice(-30).map((l) => `      ${l}`));
      }
    }
    io.out(`${lines.join('\n')}\n`);
  }

  if (opts.summary) {
    const md = [`### Reliability checklist — ${matches.length} item(s) triggered`, ''];
    if (!matches.length) md.push('No checklist item matches this diff.');
    for (const m of matches) {
      const auto = results.filter((r) => r.id === m.item.id);
      const mark = auto.length ? (auto.every((r) => r.ok) ? '✅' : '❌') : '👀';
      md.push(`- ${mark} **${m.item.id} ${m.item.title}** — ${m.item.check} _(source: ${m.item.source})_`);
    }
    md.push('', '✅ automated check passed · ❌ automated check failed · 👀 for the author and reviewer to confirm', '');
    appendFileSync(opts.summary, `${md.join('\n')}\n`);
  }

  if (opts.record && !failed.length) {
    const { appendRecord } = await import(pathToFileURL(join(HERE, 'verify-record.mjs')).href);
    const automated = new Set(results.map((r) => r.cmd)).size;
    appendRecord({
      repo,
      label: `reliability-check (${matches.length} item${matches.length === 1 ? '' : 's'}${matches.length ? `: ${matches.map((m) => m.item.id).join(' ')}` : ''}; ${automated} automated)`,
      command: `node scripts/reliability-check.mjs --run --base ${opts.base}`,
    });
  }
  return failed.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
