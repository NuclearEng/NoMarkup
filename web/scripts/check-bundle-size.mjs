#!/usr/bin/env node
/**
 * PERF-07 / PERF-08 — First Load JS budget gate for the Next.js App Router build.
 *
 * Run after a production build:
 *   cd web && npm run build && npm run check:bundle
 *   # or from repo root (after web build):
 *   node web/scripts/check-bundle-size.mjs
 *
 * If `next dev` is writing web/.next, isolate the production output:
 *   cd web && NEXT_DIST_DIR=.next-prod npm run build
 *   NEXT_DIR=web/.next-prod node web/scripts/check-bundle-size.mjs
 *
 * Env:
 *   NEXT_DIR          path to production build output (default: web/.next)
 *   WEB_DIR           web package root (default: inferred from script location)
 *   BUNDLE_CHECK_ALL=1  print every route, not just the heaviest 25
 *
 * Sizes match `next build` "First Load JS" (gzip of client .js chunks from
 * app-build-manifest / common-to-all files). Budgets are documented in
 * CLAUDE.md §14 and docs/performance.md (shared ≤190 kB, interactive ≤300 kB).
 *
 * Exit codes:
 *   0 — all budgets green
 *   1 — budget regression or missing/invalid production .next
 *   2 — usage / unexpected I/O error
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Budgets (kB ≈ Next `pretty-bytes` SI units, 1000) ────────────────────────

/** Shared First Load JS common to every app entry (React/Next floor). */
const SHARED_BUDGET_KB = 190;

/** Default max First Load JS for any page route. */
const DEFAULT_ROUTE_BUDGET_KB = 300;

/**
 * PERF-08 allowlist: route → max First Load JS (kB gzip).
 *
 * Units match `next build` "First Load JS" (gzip, pretty-bytes ≈ 1000).
 * Product docs first accepted `/jobs/[id]` 375 / `/jobs/new` 309
 * (docs/performance.md); ceilings below were re-measured from `next build` at
 * PERF-07 ship (2026-07-27) so CI fails only on further regression.
 * Ratchet toward DEFAULT_ROUTE_BUDGET_KB when product allows — never raise
 * without updating docs/performance.md + this map.
 *
 * Route keys match app-path-routes-manifest URL paths (route groups stripped).
 */
const ROUTE_ALLOWLIST_KB = Object.freeze({
  // Heaviest interactive surfaces (PERF-08 + 2026-07-27 re-baseline)
  '/jobs/[id]': 395,
  '/jobs/new': 325,
  '/sell/new': 340,
  '/auctions/[id]/replay': 330,
  '/auctions/[id]/spectate': 325,
  '/provider/onboarding': 320,
  '/marketplace/[id]': 320,
  '/messages': 310,
  '/demo/auction': 310,
});

/** SI kilobyte — same basis Next uses in the build tree view. */
const KB = 1000;

// ── CLI / paths ──────────────────────────────────────────────────────────────

const webRoot = resolveWebRoot();
// NEXT_DIR: absolute/relative path to a production `.next` (or a snapshot of one).
// Useful when `next dev` is racing the default web/.next directory locally.
const nextDir = process.env.NEXT_DIR
  ? path.resolve(process.env.NEXT_DIR)
  : path.join(webRoot, '.next');

function resolveWebRoot() {
  if (process.env.WEB_DIR) return path.resolve(process.env.WEB_DIR);
  // script lives at web/scripts/… → parent is web/
  const fromScript = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(fromScript, 'package.json'))) return fromScript;
  // cwd is web/
  if (fs.existsSync(path.join(process.cwd(), 'next.config.ts')) ||
      fs.existsSync(path.join(process.cwd(), 'next.config.js'))) {
    return process.cwd();
  }
  // cwd is repo root
  const fromCwd = path.join(process.cwd(), 'web');
  if (fs.existsSync(path.join(fromCwd, 'package.json'))) return fromCwd;
  return fromScript;
}

function die(msg, code = 1) {
  console.error(`check-bundle-size: ${msg}`);
  process.exit(code);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    die(`failed to read ${file}: ${err instanceof Error ? err.message : err}`, 2);
  }
}

// ── Gzip sizing (Next uses compiled gzip-size ≈ zlib level 9) ─────────────────

const sizeCache = new Map();

function gzipBytes(relFromNext) {
  if (sizeCache.has(relFromNext)) return sizeCache.get(relFromNext);
  const abs = path.join(nextDir, relFromNext);
  if (!fs.existsSync(abs)) {
    sizeCache.set(relFromNext, 0);
    return 0;
  }
  const buf = fs.readFileSync(abs);
  const n = zlib.gzipSync(buf, { level: 9 }).length;
  sizeCache.set(relFromNext, n);
  return n;
}

function formatKb(bytes) {
  return (bytes / KB).toFixed(1);
}

function budgetBytes(kb) {
  return Math.round(kb * KB);
}

// ── Manifest load + production guard ─────────────────────────────────────────

function loadProductionManifests() {
  if (!fs.existsSync(nextDir)) {
    die(
      `missing ${nextDir}. Run a production build first: cd web && npm run build`,
    );
  }

  const buildManifestPath = path.join(nextDir, 'build-manifest.json');
  const appBuildPath = path.join(nextDir, 'app-build-manifest.json');
  const routesPath = path.join(nextDir, 'app-path-routes-manifest.json');

  for (const p of [buildManifestPath, appBuildPath, routesPath]) {
    if (!fs.existsSync(p)) {
      die(`missing ${p}. Run: cd web && npm run build`);
    }
  }

  const buildManifest = readJson(buildManifestPath);
  const appBuild = readJson(appBuildPath);
  const routes = readJson(routesPath);

  // Dev / turbopack artifacts must not be measured as production First Load.
  const low = buildManifest.lowPriorityFiles || [];
  const rootMain = buildManifest.rootMainFiles || [];
  const isDev =
    low.some((f) => String(f).includes('/development/')) ||
    rootMain.some((f) => String(f).includes('turbopack') || String(f).includes('hmr-client')) ||
    Object.keys(appBuild.pages || {}).some((k) =>
      (appBuild.pages[k] || []).some((f) => String(f).includes('turbopack')),
    );

  if (isDev) {
    die(
      '`.next` looks like a development (turbopack) build. ' +
        'Run a production build: cd web && npm run build',
    );
  }

  const pageCount = Object.keys(appBuild.pages || {}).length;
  if (pageCount < 2) {
    die(
      `app-build-manifest has only ${pageCount} entries — not a complete production build. ` +
        'Run: cd web && npm run build',
    );
  }

  return { buildManifest, appBuild, routes };
}

// ── First Load computation (mirrors next/dist/build/utils computeFromManifest) ─

function computeAppStats(appBuild) {
  const each = new Map();
  const keys = Object.keys(appBuild.pages || {});
  for (const key of keys) {
    for (const file of appBuild.pages[key] || []) {
      if (!file.endsWith('.js')) continue;
      each.set(file, (each.get(file) || 0) + 1);
    }
  }
  const expected = keys.length;
  const commonFiles = [...each.entries()]
    .filter(([, n]) => n === expected)
    .map(([f]) => f);
  const uniqueFiles = new Set(
    [...each.entries()].filter(([, n]) => n === 1).map(([f]) => f),
  );
  const commonBytes = commonFiles.reduce((sum, f) => sum + gzipBytes(f), 0);
  return { keys, expected, commonFiles, uniqueFiles, commonBytes };
}

function isPageEntry(manifestKey) {
  return manifestKey === '/page' || /\/page$/.test(manifestKey);
}

function routeForKey(manifestKey, routes) {
  if (routes[manifestKey]) return routes[manifestKey];
  // Fallback: strip route groups + trailing /page
  return manifestKey
    .replace(/\/\([^/]+\)/g, '')
    .replace(/\/page$/, '')
    .replace(/^$/, '/');
}

function firstLoadForEntry(files) {
  return files
    .filter((f) => f.endsWith('.js'))
    .reduce((sum, f) => sum + gzipBytes(f), 0);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const { appBuild, routes } = loadProductionManifests();
  const stats = computeAppStats(appBuild);

  const failures = [];
  const warnings = [];
  const rows = [];

  // Shared budget
  const sharedKb = stats.commonBytes / KB;
  const sharedOk = stats.commonBytes <= budgetBytes(SHARED_BUDGET_KB);
  if (!sharedOk) {
    failures.push(
      `shared First Load JS ${formatKb(stats.commonBytes)} kB > budget ${SHARED_BUDGET_KB} kB`,
    );
  }

  // Per-page First Load
  for (const key of stats.keys) {
    if (!isPageEntry(key)) continue;
    // Skip non-UI route handlers if any slipped through as …/page
    if (key.includes('/api/')) continue;

    const files = appBuild.pages[key] || [];
    const total = firstLoadForEntry(files);
    const route = routeForKey(key, routes);
    const allowKb = ROUTE_ALLOWLIST_KB[route];
    const budgetKb = allowKb ?? DEFAULT_ROUTE_BUDGET_KB;
    const ok = total <= budgetBytes(budgetKb);
    const allowlisted = allowKb != null;

    rows.push({ route, total, budgetKb, allowlisted, ok });

    if (!ok) {
      failures.push(
        `${route}: First Load JS ${formatKb(total)} kB > budget ${budgetKb} kB` +
          (allowlisted ? ' (allowlisted ceiling)' : ''),
      );
    } else if (
      !allowlisted &&
      total > budgetBytes(DEFAULT_ROUTE_BUDGET_KB * 0.95)
    ) {
      warnings.push(
        `${route}: ${formatKb(total)} kB is within ${DEFAULT_ROUTE_BUDGET_KB} kB but ≥95% of budget`,
      );
    }
  }

  rows.sort((a, b) => b.total - a.total);

  // Report
  console.log('First Load JS budget check (gzip, production .next)');
  console.log(`  web root : ${webRoot}`);
  console.log(`  next dir : ${nextDir}`);
  console.log(`  shared   : ${formatKb(stats.commonBytes)} kB  (budget ≤ ${SHARED_BUDGET_KB} kB) ${sharedOk ? 'OK' : 'FAIL'}`);
  console.log(`  common chunks (${stats.commonFiles.length}):`);
  for (const f of stats.commonFiles.sort()) {
    console.log(`    ${formatKb(gzipBytes(f)).padStart(7)} kB  ${f}`);
  }
  console.log('');
  console.log(
    '  route'.padEnd(42) +
      'first load'.padStart(12) +
      'budget'.padStart(10) +
      '  status',
  );
  console.log('  ' + '-'.repeat(70));

  const show = process.env.BUNDLE_CHECK_ALL === '1' ? rows : rows.slice(0, 25);
  for (const r of show) {
    const flag = r.ok ? (r.allowlisted ? 'OK* ' : 'OK  ') : 'FAIL';
    const note = r.allowlisted ? ' allowlist' : '';
    console.log(
      `  ${r.route.padEnd(40)} ${formatKb(r.total).padStart(8)} kB ${String(r.budgetKb).padStart(6)} kB  ${flag}${note}`,
    );
  }
  if (show.length < rows.length) {
    console.log(`  … ${rows.length - show.length} more routes (set BUNDLE_CHECK_ALL=1 to list all)`);
  }

  if (Object.keys(ROUTE_ALLOWLIST_KB).length) {
    console.log('');
    console.log('  PERF-08 allowlist ceilings (kB):');
    for (const [route, kb] of Object.entries(ROUTE_ALLOWLIST_KB)) {
      const row = rows.find((r) => r.route === route);
      const actual = row ? `${formatKb(row.total)} kB` : '(route not in this build)';
      console.log(`    ${route.padEnd(32)} ≤ ${kb} kB  (actual ${actual})`);
    }
  }

  if (warnings.length) {
    console.log('');
    console.log('  near-budget warnings:');
    for (const w of warnings) console.log(`    ⚠ ${w}`);
  }

  console.log('');
  if (failures.length) {
    console.error(`FAIL: ${failures.length} budget violation(s):`);
    for (const f of failures) console.error(`  • ${f}`);
    console.error(
      '\nBudgets: docs/performance.md + CLAUDE.md §14. ' +
        'Raise ROUTE_ALLOWLIST_KB only with a written PERF exception.',
    );
    process.exit(1);
  }

  console.log(`OK: shared ≤ ${SHARED_BUDGET_KB} kB; ${rows.length} page routes within budget/allowlist.`);
  process.exit(0);
}

try {
  main();
} catch (err) {
  die(err instanceof Error ? err.stack || err.message : String(err), 2);
}
