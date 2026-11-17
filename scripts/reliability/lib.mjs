// Shared helpers for the diff-triggered reliability checklist
// (scripts/reliability-check.mjs) and its automated checks
// (scripts/reliability/checks.mjs). No dependencies beyond Node itself, so CI
// can run the base branch's copy without `npm ci`.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Run git and return stdout. Throws with git's stderr on failure. */
export function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Translate a repo-relative glob into an anchored RegExp.
 *   `**` / `** /` any number of path segments, `*` within one segment,
 *   `?` one character, `{a,b}` alternation. Everything else is literal.
 */
export function globToRegExp(glob) {
  let re = '';
  let i = 0;
  let inBrace = false;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
        continue;
      }
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      re += '(?:';
      inBrace = true;
    } else if (c === '}' && inBrace) {
      re += ')';
      inBrace = false;
    } else if (c === ',' && inBrace) {
      re += '|';
    } else if ('\\^$.|+()[]'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
    i += 1;
  }
  return new RegExp(`^${re}$`);
}

/**
 * True when `path` matches at least one positive glob and no `!negated` one.
 * An empty glob list matches everything.
 */
export function pathMatches(globs, path) {
  if (globs.length === 0) return true;
  let positive = false;
  let hasPositive = false;
  for (const g of globs) {
    if (g.startsWith('!')) {
      if (globToRegExp(g.slice(1)).test(path)) return false;
    } else {
      hasPositive = true;
      if (!positive && globToRegExp(g).test(path)) positive = true;
    }
  }
  return hasPositive ? positive : true;
}

/**
 * Parse `git diff -U0` output into per-file added/removed lines.
 * Returns Map<path, {path, oldPath, added: [{line, text}], removed: [{line, text}], binary}>.
 */
export function parseUnifiedDiff(text) {
  const files = new Map();
  let cur = null;
  let inHeader = false;
  let oldLine = 0;
  let newLine = 0;
  let minusPath = null;
  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      cur = null;
      inHeader = true;
      minusPath = null;
      // Fallback path from the header, used for binary / mode-only changes.
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(raw);
      if (m) {
        cur = { path: m[2], oldPath: m[1] === m[2] ? null : m[1], added: [], removed: [], binary: false };
        files.set(cur.path, cur);
      }
      continue;
    }
    if (inHeader) {
      if (raw.startsWith('--- ')) {
        minusPath = raw.slice(4) === '/dev/null' ? null : raw.slice(4).replace(/^a\//, '');
      } else if (raw.startsWith('+++ ')) {
        const plus = raw.slice(4) === '/dev/null' ? null : raw.slice(4).replace(/^b\//, '');
        const path = plus ?? minusPath;
        if (cur && path && path !== cur.path) {
          files.delete(cur.path);
          cur.path = path;
          files.set(path, cur);
        }
      } else if (raw.startsWith('Binary files ')) {
        if (cur) cur.binary = true;
      } else if (raw.startsWith('@@')) {
        inHeader = false;
      }
      if (inHeader) continue;
    }
    if (!cur) continue;
    if (raw.startsWith('@@')) {
      const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (h) {
        oldLine = Number(h[1]);
        newLine = Number(h[2]);
      }
      continue;
    }
    if (raw.startsWith('+')) {
      cur.added.push({ line: newLine, text: raw.slice(1) });
      newLine += 1;
    } else if (raw.startsWith('-')) {
      cur.removed.push({ line: oldLine, text: raw.slice(1) });
      oldLine += 1;
    } else if (raw.startsWith(' ')) {
      oldLine += 1;
      newLine += 1;
    }
  }
  return files;
}

const STATUS = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', T: 'modified' };

/**
 * Everything that differs between the merge base of `base` and the working
 * tree: committed, staged, unstaged and untracked changes. Each entry is
 * {path, oldPath, status, added, removed, binary}.
 */
export function collectDiff({ cwd, base }) {
  let mergeBase;
  try {
    mergeBase = git(['merge-base', base, 'HEAD'], cwd).trim();
  } catch {
    throw new Error(
      `cannot find a merge base with ${base} — fetch it first (git fetch origin main) or pass --base <ref>`,
    );
  }
  const files = new Map();
  const nameStatus = git(['diff', '--name-status', '-M', '--no-color', mergeBase], cwd);
  for (const line of nameStatus.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0][0];
    const status = STATUS[code] ?? 'modified';
    const path = parts.length === 3 ? parts[2] : parts[1];
    const oldPath = parts.length === 3 ? parts[1] : null;
    files.set(path, { path, oldPath, status, added: [], removed: [], binary: false });
  }
  const diff = parseUnifiedDiff(
    git(['diff', '-U0', '-M', '--no-color', '--no-ext-diff', mergeBase], cwd),
  );
  for (const [path, d] of diff) {
    const f = files.get(path) ?? { path, oldPath: d.oldPath, status: 'modified', binary: false };
    files.set(path, { ...f, added: d.added, removed: d.removed, binary: d.binary });
  }
  const untracked = git(['ls-files', '--others', '--exclude-standard'], cwd);
  for (const path of untracked.split('\n')) {
    if (!path) continue;
    const entry = { path, oldPath: null, status: 'added', added: [], removed: [], binary: false };
    try {
      const abs = join(cwd, path);
      if (statSync(abs).size <= 2 * 1024 * 1024) {
        const buf = readFileSync(abs);
        if (buf.includes(0)) entry.binary = true;
        else entry.added = buf.toString('utf8').split('\n').map((text, i) => ({ line: i + 1, text }));
      } else {
        entry.binary = true;
      }
    } catch {
      entry.binary = true;
    }
    files.set(path, entry);
  }
  return { mergeBase, files: [...files.values()] };
}
