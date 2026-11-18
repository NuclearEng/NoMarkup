// node --test web/scripts/check-npm-audit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { blockingAdvisories, chainsTo, evaluate } from './check-npm-audit.mjs';

const ID = 'GHSA-fc5q-39xc-vjpf';
const PATHS = ['@sentry/nextjs > @rollup/plugin-commonjs > picomatch'];

const report = (vias) => ({
  metadata: { vulnerabilities: { critical: 0, high: 1, moderate: 0, low: 0 } },
  vulnerabilities: {
    picomatch: { via: vias },
    '@rollup/plugin-commonjs': { severity: 'high', via: ['picomatch'] },
  },
});
const advisory = (over = {}) => ({
  name: 'picomatch', severity: 'high', title: 'ReDoS', url: `https://github.com/advisories/${ID}`, ...over,
});
const entry = (over = {}) => ({
  advisory: ID, package: 'picomatch', paths: PATHS, reason: 'build-time only', evidence: ['probe: 0 calls'],
  removeWhen: 'fixed release', added: '2026-11-17', reviewBy: '2027-01-15', ...over,
});
const run = (r, entries, chains = PATHS, today = '2026-11-17') =>
  evaluate({ report: r, allowlist: { entries }, chainsFor: () => chains, today });

test('allowlisted advisory on exactly the listed paths passes', () => {
  const { problems, accepted } = run(report([advisory()]), [entry()]);
  assert.deepEqual(problems, []);
  assert.equal(accepted.length, 1);
});

test('an advisory that is not allowlisted fails', () => {
  const { problems } = run(report([advisory({ url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' })]), [entry()]);
  assert.ok(problems.some((p) => p.includes('GHSA-aaaa-bbbb-cccc')));
  assert.ok(problems.some((p) => p.includes('no longer matches')), 'the unused entry is stale too');
});

test('critical counts, moderate does not', () => {
  assert.equal(blockingAdvisories(report([advisory({ severity: 'critical' })])).length, 1);
  assert.equal(blockingAdvisories(report([advisory({ severity: 'moderate' })])).length, 0);
});

test('a new dependency path to the package fails', () => {
  const { problems } = run(report([advisory()]), [entry()], [...PATHS, 'some-runtime-lib > picomatch']);
  assert.ok(problems.some((p) => p.includes('new dependency path') && p.includes('some-runtime-lib')));
});

test('a listed path that is no longer installed fails', () => {
  const { problems } = run(report([advisory()]), [entry({ paths: [...PATHS, 'gone > picomatch'] })]);
  assert.ok(problems.some((p) => p.includes('no longer installed') && p.includes('gone > picomatch')));
});

test('an entry whose advisory is no longer reported fails (cannot go stale)', () => {
  const { problems } = run({ metadata: { vulnerabilities: {} }, vulnerabilities: {} }, [entry()]);
  assert.ok(problems.some((p) => p.includes('no longer matches')));
});

test('expired entry fails and the advisory is reported again', () => {
  const { problems } = run(report([advisory()]), [entry()], PATHS, '2027-01-16');
  assert.ok(problems.some((p) => p.includes('expired')));
  assert.ok(problems.some((p) => p.startsWith('high:')));
});

test('reviewBy more than 60 days after added fails', () => {
  const { problems } = run(report([advisory()]), [entry({ reviewBy: '2027-01-17' })]);
  assert.ok(problems.some((p) => p.includes('within 60 days')));
});

test('missing evidence or removal condition fails', () => {
  const { problems } = run(report([advisory()]), [entry({ evidence: [], removeWhen: '' })]);
  assert.ok(problems.some((p) => p.includes('missing evidence, removeWhen')));
});

test('chainsTo walks npm ls JSON, including deduped leaves', () => {
  const tree = { dependencies: { a: { dependencies: { b: { dependencies: { picomatch: {} } }, picomatch: {} } }, c: {} } };
  assert.deepEqual(chainsTo(tree, 'picomatch'), ['a > b > picomatch', 'a > picomatch']);
});

test('the checked-in allowlist is well formed and unexpired today', () => {
  const allowlist = JSON.parse(fs.readFileSync(new URL('../audit-allowlist.json', import.meta.url), 'utf8'));
  const entries = allowlist.entries;
  const r = report(entries.map((e) => advisory({ name: e.package, url: `https://github.com/advisories/${e.advisory}` })));
  const { problems } = evaluate({
    report: r, allowlist, chainsFor: (pkg) => entries.find((e) => e.package === pkg).paths,
    today: new Date().toISOString().slice(0, 10),
  });
  assert.deepEqual(problems, []);
});
