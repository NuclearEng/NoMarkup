// node --test scripts/verify-record.test.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { appendRecord, coveringLabels, recordPath, stampMessage } from './verify-record.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'vr-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'test');
  g('config', 'user.email', 'nobody');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  writeFileSync(join(dir, 'b.txt'), 'two\n');
  g('add', '.');
  g('commit', '-qm', 'init');
  // the tools under test, so `node scripts/verify-record.mjs` works inside it
  mkdirSync(join(dir, 'scripts', 'hooks'), { recursive: true });
  copyFileSync(join(HERE, 'verify-record.mjs'), join(dir, 'scripts', 'verify-record.mjs'));
  copyFileSync(join(HERE, 'hooks', 'commit-msg'), join(dir, 'scripts', 'hooks', 'commit-msg'));
  chmodSync(join(dir, 'scripts', 'hooks', 'commit-msg'), 0o755);
  writeFileSync(join(dir, '.gitignore'), 'scripts/\n');
  g('add', '.gitignore');
  g('commit', '-qm', 'ignore tools');
  return { dir, g };
}

const msg = (dir, text) => {
  const p = join(dir, 'MSG');
  writeFileSync(p, text);
  return p;
};

test('a record covers the commit only when every staged file has the recorded content', () => {
  const { dir, g } = repo();
  writeFileSync(join(dir, 'a.txt'), 'one changed\n');
  appendRecord({ repo: dir, label: 'web lint', command: 'npm run lint' });
  g('add', 'a.txt');
  assert.deepEqual(coveringLabels(dir), ['web lint']);

  // a change after the check ran: the record no longer covers it
  writeFileSync(join(dir, 'a.txt'), 'one changed again\n');
  g('add', 'a.txt');
  assert.deepEqual(coveringLabels(dir), []);

  // a staged file the check never saw changed: not covered either
  writeFileSync(join(dir, 'a.txt'), 'one changed\n');
  writeFileSync(join(dir, 'b.txt'), 'two changed\n');
  g('add', 'a.txt', 'b.txt');
  assert.deepEqual(coveringLabels(dir), []);
});

test('deletions are matched too, and stale records (over 24h) are ignored', () => {
  const { dir, g } = repo();
  g('rm', '-q', 'b.txt');
  appendRecord({ repo: dir, label: 'old', command: 'x', now: new Date(Date.now() - 25 * 3600 * 1000) });
  appendRecord({ repo: dir, label: 'fresh', command: 'y' });
  assert.deepEqual(coveringLabels(dir), ['fresh']);
});

test('stamp replaces whatever Verified-by the author typed and keeps Co-Authored-By last', () => {
  const { dir, g } = repo();
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  g('add', 'a.txt');
  const file = msg(dir, 'fix: thing\n\nVerified-by: everything, trust me\n\nCo-Authored-By: Someone <nobody>\n');
  assert.equal(stampMessage(dir, file), 'none');
  const out = readFileSync(file, 'utf8');
  assert.doesNotMatch(out, /trust me/);
  assert.match(out, /Verified-by: none\nCo-Authored-By: Someone <nobody>\n$/);

  appendRecord({ repo: dir, label: 'go test (gateway)', command: 'go test ./...' });
  appendRecord({ repo: dir, label: 'reliability-check (2 items: RC-01 RC-08; 1 automated)', command: 'node' });
  appendRecord({ repo: dir, label: 'go test (gateway)', command: 'go test ./...' });
  const file2 = msg(dir, 'fix: thing\n');
  stampMessage(dir, file2);
  assert.equal(readFileSync(file2, 'utf8'), 'fix: thing\n\nVerified-by: go test (gateway); reliability-check (2 items: RC-01 RC-08; 1 automated)\n');
});

test('`run` records only a passing command that leaves the tree as it found it', () => {
  const { dir, g } = repo();
  writeFileSync(join(dir, 'a.txt'), 'edited\n');
  const cli = (...args) => spawnSync('node', ['scripts/verify-record.mjs', ...args], { cwd: dir, encoding: 'utf8' });

  assert.equal(cli('run', '--label', 'failing', '--', 'false').status, 1);
  const mutating = cli('run', '--label', 'mutating', '--', 'sh', '-c', 'echo more >> b.txt');
  assert.equal(mutating.status, 0);
  assert.match(mutating.stderr, /changed the working tree; not recorded/);
  writeFileSync(join(dir, 'b.txt'), 'two\n');
  assert.equal(cli('run', '--label', 'passing', '--', 'true').status, 0);

  const labels = readFileSync(recordPath(dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l).label);
  assert.deepEqual(labels, ['passing']);
  g('add', 'a.txt');
  assert.equal(cli('show').stdout.trim(), 'passing');
});

test('the commit-msg hook stamps a real commit and never blocks it', () => {
  const { dir, g } = repo();
  const commit = (m) => g('-c', `core.hooksPath=${join(dir, 'scripts', 'hooks')}`, 'commit', '-qm', m);

  writeFileSync(join(dir, 'a.txt'), 'hooked\n');
  spawnSync('node', ['scripts/verify-record.mjs', 'run', '--label', 'unit tests', '--', 'true'], { cwd: dir });
  g('add', 'a.txt');
  commit('feat: covered\n\nVerified-by: typed by hand');
  assert.match(g('log', '-1', '--format=%B'), /^feat: covered\n\nVerified-by: unit tests\n/);

  writeFileSync(join(dir, 'b.txt'), 'unverified\n');
  g('add', 'b.txt');
  commit('feat: not covered');
  assert.match(g('log', '-1', '--format=%B'), /Verified-by: none/);
});
