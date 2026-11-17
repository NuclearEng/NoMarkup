// node --test scripts/reliability-check.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { main, matchItems, parseChecklist } from './reliability-check.mjs';
import { CHECKS } from './reliability/checks.mjs';
import { globToRegExp, parseUnifiedDiff, pathMatches } from './reliability/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKLIST = readFileSync(join(ROOT, 'docs/reliability-checklist.md'), 'utf8');
const git = (args, cwd = ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1e9 });

const file = (path, { added = [], removed = [], status = 'modified', oldPath = null } = {}) => ({
  path,
  oldPath,
  status,
  added: added.map((text, i) => ({ line: i + 1, text })),
  removed: removed.map((text, i) => ({ line: i + 1, text })),
});

const ITEMS_MD = `
### RC-01 · Paths only
- **Paths:** \`deploy/docker/*.Dockerfile\`
- **Check:** copy the module.
- **Source:** abc123.

### RC-02 · Added regex inside paths
- **Paths:** \`gateway/**/*.go\` \`!**/*_test.go\`
- **Added:** \`\\.Incr\\(\`
- **Check:** ttl.
- **Source:** def456.

### RC-03 · Removed regex anywhere
- **Removed:** \`\\?\\?\\s\`
- **Check:** keep the guard
  unless the field is always sent.
- **Source:** 8558aba2.

### RC-04 · Status filter
- **Paths:** \`database/migrations/*.sql\`
- **Status:** \`modified\` \`deleted\`
- **Check:** never edit.
- **Run:** \`true\`
- **Source:** CLAUDE.md.
`;

test('globToRegExp: segments, double star, braces, literal dots', () => {
  assert.ok(globToRegExp('deploy/docker/*.Dockerfile').test('deploy/docker/web.Dockerfile'));
  assert.ok(!globToRegExp('deploy/docker/*.Dockerfile').test('deploy/docker/sub/web.Dockerfile'));
  assert.ok(globToRegExp('**/go.mod').test('go.mod'));
  assert.ok(globToRegExp('**/go.mod').test('services/user/go.mod'));
  assert.ok(globToRegExp('web/src/**').test('web/src/app/page.tsx'));
  assert.ok(globToRegExp('web/{src,tests}/*.ts').test('web/tests/a.ts'));
  assert.ok(!globToRegExp('a.b').test('axb'));
  assert.ok(globToRegExp('ios/NoMarkup/Info.plist').test('ios/NoMarkup/Info.plist'));
});

test('pathMatches: negation excludes, no globs means everything', () => {
  assert.ok(pathMatches(['gateway/**/*.go', '!**/*_test.go'], 'gateway/internal/cache/counter.go'));
  assert.ok(!pathMatches(['gateway/**/*.go', '!**/*_test.go'], 'gateway/internal/cache/counter_test.go'));
  assert.ok(pathMatches([], 'anything/at/all'));
});

test('parseChecklist reads fields, continuation lines and regexes', () => {
  const items = parseChecklist(ITEMS_MD);
  assert.equal(items.length, 4);
  assert.deepEqual(items[0].paths, ['deploy/docker/*.Dockerfile']);
  assert.ok(items[1].added[0].test('x.Incr(ctx, key)'));
  assert.equal(items[2].check, 'keep the guard unless the field is always sent.');
  assert.deepEqual(items[3].status, ['modified', 'deleted']);
  assert.deepEqual(items[3].run, ['true']);
});

test('parseChecklist rejects malformed items instead of dropping them', () => {
  assert.throws(() => parseChecklist('### RC-01 · No trigger\n- **Check:** x\n- **Source:** y\n'), /needs Paths, Added or Removed/);
  assert.throws(() => parseChecklist('### RC-01 · Bad\n- **Added:** `(`\n- **Check:** x\n- **Source:** y\n'), /bad Added regex/);
  assert.throws(() => parseChecklist('### RC-01 · A\n- **Paths:** `a`\n- **Check:** x\n'), /missing Source/);
  assert.throws(() => parseChecklist('### RC-01 · A\n- **Paths:** `a`\n- **Chek:** x\n- **Source:** y\n'), /unknown field Chek/);
  const dup = '### RC-01 · A\n- **Paths:** `a`\n- **Check:** x\n- **Source:** y\n';
  assert.throws(() => parseChecklist(dup + dup), /duplicate id/);
});

test('matchItems: path-only, path+regex, removed-only and status triggers', () => {
  const items = parseChecklist(ITEMS_MD);
  const ids = (files) => matchItems(items, files).map((m) => m.item.id);

  assert.deepEqual(ids([file('deploy/docker/user.Dockerfile')]), ['RC-01']);
  assert.deepEqual(ids([file('gateway/internal/handler/spectator_ws.go', { added: ['n, _ := rdb.Incr(ctx, key).Result()'] })]), ['RC-02']);
  // same line in a test file is excluded by the negated glob
  assert.deepEqual(ids([file('gateway/internal/handler/spectator_ws_test.go', { added: ['rdb.Incr(ctx, k)'] })]), []);
  // a path match without a matching line does not trigger a regex item
  assert.deepEqual(ids([file('gateway/internal/handler/spectator_ws.go', { added: ['return nil'] })]), []);
  assert.deepEqual(ids([file('web/src/app/jobs/[id]/JobDetailClient.tsx', { removed: ['const n = job.snipe_extension_count ?? 0;'] })]), ['RC-03']);
  assert.deepEqual(ids([file('database/migrations/001_init.up.sql', { status: 'added' })]), []);
  assert.deepEqual(ids([file('database/migrations/001_init.up.sql', { status: 'modified' })]), ['RC-04']);
});

test('matchItems reports counts, never line text', () => {
  const items = parseChecklist('### RC-01 · Secret\n- **Added:** `sk_test_`\n- **Check:** x\n- **Source:** y\n');
  const fake = ['sk', 'test', 'abcdefgh'].join('_'); // built from parts: RC-41
  const [m] = matchItems(items, [file('web/tests/a.test.ts', { added: [`const k = "${fake}"`] })]);
  assert.deepEqual(m.files, ['web/tests/a.test.ts']);
  assert.equal(m.lines, 1);
  assert.ok(!JSON.stringify({ files: m.files, lines: m.lines }).includes('abcdefgh'));
});

test('parseUnifiedDiff: line numbers, deletions, renames, binary and "---" content lines', () => {
  const diff = [
    'diff --git a/a.go b/a.go',
    'index 1..2 100644',
    '--- a/a.go',
    '+++ b/a.go',
    '@@ -10,2 +10,3 @@ func x() {',
    '-old',
    '--- a removed line that starts with two dashes',
    '+new',
    '+++ an added line that starts with two pluses',
    '+third',
    'diff --git a/gone.txt b/gone.txt',
    'deleted file mode 100644',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye',
    'diff --git a/old/name.ts b/new/name.ts',
    'similarity index 90%',
    'rename from old/name.ts',
    'rename to new/name.ts',
    '--- a/old/name.ts',
    '+++ b/new/name.ts',
    '@@ -3 +3 @@',
    '-x',
    '+y',
    'diff --git a/logo.png b/logo.png',
    'Binary files a/logo.png and b/logo.png differ',
  ].join('\n');
  const files = parseUnifiedDiff(diff);
  const a = files.get('a.go');
  assert.deepEqual(a.removed.map((l) => [l.line, l.text]), [[10, 'old'], [11, '-- a removed line that starts with two dashes']]);
  assert.deepEqual(a.added.map((l) => [l.line, l.text]), [[10, 'new'], [11, '++ an added line that starts with two pluses'], [12, 'third']]);
  assert.deepEqual(files.get('gone.txt').removed.map((l) => l.text), ['bye']);
  assert.equal(files.get('new/name.ts').oldPath, 'old/name.ts');
  assert.ok(files.get('logo.png').binary);
});

test('the real checklist parses, stays between 25 and 45 items, numbered in order', () => {
  const items = parseChecklist(CHECKLIST);
  assert.ok(items.length >= 25 && items.length <= 45, `${items.length} items`);
  items.forEach((it, i) => assert.equal(it.id, `RC-${String(i + 1).padStart(2, '0')}`));
  for (const it of items) assert.ok(it.source.length > 3, `${it.id} has a source`);
});

test('every Run line names a check or file that exists', () => {
  for (const it of parseChecklist(CHECKLIST)) {
    for (const cmd of it.run) {
      const named = /checks\.mjs"?\s+([a-z-]+)/.exec(cmd);
      if (named) assert.ok(CHECKS[named[1]], `${it.id}: unknown check ${named[1]}`);
      const script = /(?:bash|node)\s+((?:scripts|web)\/\S+)/.exec(cmd);
      if (script) assert.ok(readFileSync(join(ROOT, script[1])), `${it.id}: ${script[1]} exists`);
    }
  }
});

// Grade the triggers against the bugs that mattered: replay the diff of the
// commit that introduced (or fixed) each incident and require its item.
const REPLAY = [
  ['e8d6c997', 'RC-01'], // PgBouncer startup parameters (compose)
  ['5e2f517f', 'RC-01'], // ... and the role-default fix
  ['d00c84db', 'RC-02'], // pkg/grpmtls replace added to every go.mod
  ['5a13b94e', 'RC-02'], // Dockerfiles copy pkg/grpmtls
  ['0b024405', 'RC-02'], // engines image copies telemetry
  ['b5f09c67', 'RC-03'], // Go pin in workflows + images
  ['c114b402', 'RC-04'], // lowercase image prefix (#46)
  ['42152da6', 'RC-05'], // Playwright off ubuntu-latest
  ['27505a8b', 'RC-06'], // hosted Xcode without simulators
  ['d00c84db', 'RC-08'], // a new Go module (pkg/grpmtls) nobody tested
  ['5e2f517f', 'RC-09'], // migration 137
  ['7ef664b6', 'RC-12'], // seeder vs contract_number_seq
  ['fef7b26d', 'RC-15'], // spectator IP counter without an atomic TTL
  ['0aad175a', 'RC-15'], // ... and its fix (#42)
  ['aa9af0d9', 'RC-16'], // Stripe deleter: strings.Contains(msg, "404")
  ['5799c94c', 'RC-17'], // personalized response publicly cached
  ['8363dde2', 'RC-18'], // RequireIdempotencyKey on place-bid
  ['dbf7f461', 'RC-24'], // next/font/google introduced
  ['2f2aa1f3', 'RC-25'], // new URL('') from empty NEXT_PUBLIC_SITE_URL
  ['b6a9e98d', 'RC-28'], // lint cleanup removed `?? 0`
  ['0f377408', 'RC-29'], // unhandled mutateAsync rejections
  ['afe7d21a', 'RC-30'], // replay timers
  ['bf26d110', 'RC-31'], // useSyncExternalStore snapshot identity
  ['ecedf67d', 'RC-32'], // retry: options?.retry
  ['aef1c834', 'RC-33'], // refused localStorage write
  ['69ec9487', 'RC-35'], // websocket backoff
  ['92e36fb0', 'RC-36'], // status badge meaning
  ['96bbda88', 'RC-37'], // Logo href `Route | string`
  ['7d1762b6', 'RC-38'], // pages.json drift
  ['04fb9da5', 'RC-40'], // tests that pinned the buggy behaviour
  ['dcd62fce', 'RC-44'], // canImport only Xcode 27 compiles
  ['222f3897', 'RC-45'], // unreferenced xcconfigs
];

const STATUS = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', T: 'modified' };
function commitFiles(sha) {
  const files = new Map();
  for (const l of git(['show', '--name-status', '-M', '--format=', sha]).split('\n').filter(Boolean)) {
    const p = l.split('\t');
    const path = p.length === 3 ? p[2] : p[1];
    files.set(path, { path, oldPath: p.length === 3 ? p[1] : null, status: STATUS[p[0][0]] ?? 'modified', added: [], removed: [] });
  }
  for (const [path, d] of parseUnifiedDiff(git(['show', '-U0', '-M', '--format=', sha]))) {
    const f = files.get(path);
    if (f) Object.assign(f, { added: d.added, removed: d.removed });
  }
  return [...files.values()];
}

const shallow = git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
test('incident replay: each source commit triggers its checklist item', { skip: shallow && 'shallow clone: the incident commits are not available (CI checks out with fetch-depth: 0)' }, () => {
  const items = parseChecklist(CHECKLIST);
  const misses = [];
  for (const [sha, id] of REPLAY) {
    const ids = matchItems(items, commitFiles(sha)).map((m) => m.item.id);
    if (!ids.includes(id)) misses.push(`${sha} should trigger ${id}, got [${ids.join(' ')}]`);
  }
  assert.deepEqual(misses, []);
});

test('main: lists triggered items for a working-tree change and fails on a failing Run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-main-'));
  const g = (args) => git(args, dir);
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.name', 'test']);
  g(['config', 'user.email', 'nobody']);
  writeFileSync(join(dir, 'README'), 'x\n');
  g(['add', '.']);
  g(['commit', '-qm', 'init']);
  // outside the repo, or the checklist file itself would be an untracked change
  const checklist = join(mkdtempSync(join(tmpdir(), 'rc-list-')), 'list.md');
  writeFileSync(checklist, [
    '### RC-01 · Passing check', '- **Paths:** `src/**`', '- **Check:** a', '- **Run:** `true`', '- **Source:** s', '',
    '### RC-02 · Failing check', '- **Added:** `BAD`', '- **Check:** b', '- **Run:** `echo boom; exit 3`', '- **Source:** s', '',
    '### RC-03 · Not triggered', '- **Paths:** `docs/**`', '- **Check:** c', '- **Source:** s', '',
  ].join('\n'));
  const out = [];
  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
  const args = ['--repo', dir, '--base', 'main', '--checklist', checklist, '--run'];

  writeFileSync(join(dir, 'src.txt'), 'fine\n');
  g(['add', 'src.txt']);
  // untracked files count as part of the change
  execFileSync('mkdir', ['-p', join(dir, 'src')]);
  writeFileSync(join(dir, 'src', 'a.ts'), 'ok\n');
  assert.equal(await main(args, io), 0);
  let text = out.join('');
  assert.match(text, /RC-01/);
  assert.doesNotMatch(text, /RC-02|RC-03/);
  assert.match(text, /PASS {2}true/);

  out.length = 0;
  writeFileSync(join(dir, 'src', 'b.ts'), 'BAD\n');
  assert.equal(await main(args, io), 1);
  text = out.join('');
  assert.match(text, /FAIL {2}echo boom; exit 3/);
  assert.match(text, /boom/);

  out.length = 0;
  assert.equal(await main(['--repo', dir, '--base', 'no-such-ref', '--checklist', checklist], io), 2);
  assert.match(out.join(''), /cannot find a merge base/);
});
