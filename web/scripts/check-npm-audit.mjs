#!/usr/bin/env node
/**
 * npm audit gate with a checked-in, expiring allowlist (web/audit-allowlist.json).
 *
 * Same policy as `npm audit --omit=dev --audit-level=high`: production dependencies, high and
 * critical advisories fail. The only difference is that an advisory listed in the allowlist is
 * accepted, and only while all of this holds:
 *   - the entry names the advisory (GHSA id), the package, every dependency path that reaches it,
 *     a reason with reachability evidence, the condition to remove it, an `added` date, and a
 *     `reviewBy` date no more than 60 days after `added`;
 *   - today is on or before `reviewBy`;
 *   - the paths match the installed tree exactly (`npm ls <pkg> --all --omit=dev`): a new path to
 *     the package fails (a new consumer was never assessed), and a listed path that no longer
 *     exists fails (the entry is stale);
 *   - npm audit still reports the advisory (otherwise the entry is stale and must be removed).
 * Any other high/critical advisory fails. If npm audit cannot run or returns no report, it fails.
 *
 * Usage (from web/):  node scripts/check-npm-audit.mjs
 * Exit: 0 pass · 1 findings or allowlist problems · 2 audit could not run
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MAX_EXCEPTION_DAYS = 60;
const BLOCKING = new Set(['high', 'critical']);
const DAY_MS = 24 * 60 * 60 * 1000;
const REQUIRED_FIELDS = ['advisory', 'package', 'paths', 'reason', 'evidence', 'removeWhen', 'added', 'reviewBy'];

/** GHSA id from an advisory URL such as https://github.com/advisories/GHSA-xxxx-xxxx-xxxx. */
export function ghsaId(url) {
  const m = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(url ?? '');
  return m ? m[0] : null;
}

/** Every high/critical advisory in an `npm audit --json` report, one per (advisory, package). */
export function blockingAdvisories(report) {
  const found = new Map();
  for (const vuln of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== 'object' || !BLOCKING.has(via.severity)) continue;
      const id = ghsaId(via.url) ?? String(via.source);
      const key = `${id} ${via.name}`;
      if (!found.has(key)) {
        found.set(key, { id, package: via.name, severity: via.severity, title: via.title, url: via.url });
      }
    }
  }
  return [...found.values()];
}

/** All dependency chains ("a > b > pkg") ending at `pkg` in an `npm ls --json` tree. */
export function chainsTo(tree, pkg) {
  const out = new Set();
  const walk = (deps, trail) => {
    for (const [name, node] of Object.entries(deps ?? {})) {
      const next = [...trail, name];
      if (name === pkg) out.add(next.join(' > '));
      if (trail.includes(name)) continue; // cycle guard
      walk(node?.dependencies, next);
    }
  };
  walk(tree?.dependencies, []);
  return [...out].sort();
}

function parseDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * Pure evaluation. `chainsFor(pkg)` returns the installed production chains to `pkg`.
 * Returns { problems: string[], accepted: string[] }.
 */
export function evaluate({ report, allowlist, chainsFor, today }) {
  const problems = [];
  const accepted = [];
  const entries = Array.isArray(allowlist?.entries) ? allowlist.entries : null;
  if (!entries) problems.push('audit-allowlist.json: "entries" must be an array');
  const todayMs = parseDay(today);

  const valid = [];
  for (const [i, e] of (entries ?? []).entries()) {
    const label = `allowlist entry ${i} (${e?.advisory ?? '?'} ${e?.package ?? '?'})`;
    const missing = REQUIRED_FIELDS.filter((f) => {
      const v = e?.[f];
      return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    });
    if (missing.length) {
      problems.push(`${label}: missing ${missing.join(', ')}`);
      continue;
    }
    const added = parseDay(e.added);
    const reviewBy = parseDay(e.reviewBy);
    if (added === null || reviewBy === null) {
      problems.push(`${label}: added / reviewBy must be YYYY-MM-DD`);
      continue;
    }
    if (reviewBy < added || (reviewBy - added) / DAY_MS > MAX_EXCEPTION_DAYS) {
      problems.push(`${label}: reviewBy must be within ${MAX_EXCEPTION_DAYS} days of added`);
      continue;
    }
    if (todayMs !== null && todayMs > reviewBy) {
      problems.push(`${label}: expired on ${e.reviewBy}; re-assess (fixed version? still unreachable?) and renew or remove it`);
      continue;
    }
    valid.push(e);
  }

  const findings = blockingAdvisories(report);
  const used = new Set();
  for (const f of findings) {
    const entry = valid.find((e) => e.advisory === f.id && e.package === f.package);
    if (!entry) {
      problems.push(`${f.severity}: ${f.id} ${f.package} — ${f.title} (${f.url ?? 'no url'})`);
      continue;
    }
    used.add(entry);
    const actual = chainsFor(f.package);
    const listed = [...new Set(entry.paths)].sort();
    const unlisted = actual.filter((c) => !listed.includes(c));
    const stale = listed.filter((c) => !actual.includes(c));
    for (const c of unlisted) problems.push(`${f.id} ${f.package}: new dependency path not in the allowlist: ${c}`);
    for (const c of stale) problems.push(`${f.id} ${f.package}: allowlisted path no longer installed (remove it): ${c}`);
    if (!unlisted.length && !stale.length) accepted.push(`${f.id} ${f.package} (review by ${entry.reviewBy}) via ${listed.length} path(s)`);
  }
  for (const e of valid) {
    if (!used.has(e)) {
      problems.push(`allowlist entry ${e.advisory} ${e.package} no longer matches any high/critical finding; remove it`);
    }
  }
  return { problems, accepted };
}

function runJson(cmd, args, cwd) {
  try {
    return JSON.parse(execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] }));
  } catch (err) {
    // npm audit / npm ls exit non-zero when they find something; their JSON is still on stdout.
    if (err && typeof err.stdout === 'string' && err.stdout.trim()) return JSON.parse(err.stdout);
    throw err;
  }
}

function main() {
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const allowlist = JSON.parse(fs.readFileSync(path.join(webDir, 'audit-allowlist.json'), 'utf8'));
  let report;
  try {
    report = runJson('npm', ['audit', '--omit=dev', '--json'], webDir);
  } catch (err) {
    console.error(`npm audit could not run: ${err.message}`);
    process.exit(2);
  }
  if (!report?.metadata?.vulnerabilities || report.error) {
    console.error(`npm audit returned no report: ${JSON.stringify(report?.error ?? report).slice(0, 500)}`);
    process.exit(2);
  }
  const chainsFor = (pkg) => chainsTo(runJson('npm', ['ls', pkg, '--all', '--omit=dev', '--json'], webDir), pkg);
  const today = new Date().toISOString().slice(0, 10);
  const { problems, accepted } = evaluate({ report, allowlist, chainsFor, today });

  const m = report.metadata.vulnerabilities;
  console.log(`npm audit (production, high+): critical ${m.critical} · high ${m.high} · moderate ${m.moderate} · low ${m.low}`);
  for (const a of accepted) console.log(`allowlisted: ${a}`);
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    process.exit(1);
  }
  console.log('npm audit gate: pass');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
