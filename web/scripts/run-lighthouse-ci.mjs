#!/usr/bin/env node
/**
 * PERF-02 — Wrapper around `@lhci/cli autorun`.
 *
 * Why a wrapper (not bare `lhci autorun`):
 *   1. Production boot fail-fasts without required env (src/lib/server/env.ts).
 *   2. Throwaway JWT public key when JWT_PUBLIC_KEY_PATH is unset.
 *   3. Isolated production dist (`NEXT_DIST_DIR=.next-lhci`) so a concurrent
 *      `next dev --turbopack` writing `web/.next` cannot poison the run.
 *   4. `output: 'standalone'` in next.config — plain `next start` is unreliable;
 *      we boot `node .next-lhci/standalone/server.js` after copying static/public.
 *   5. Default port 3011 avoids clobbering a local dev server on :3000.
 *   6. CHROME_PATH ← Playwright Chromium when unset.
 *
 * Usage:
 *   cd web && npm run lighthouse:ci
 *   LHCI_NUMBER_OF_RUNS=3 npm run lighthouse:ci
 *   LHCI_SKIP_BUILD=1 npm run lighthouse:ci
 *   LHCI_FORCE_BUILD=1 npm run lighthouse:ci
 *   LHCI_PORT=3020 npm run lighthouse:ci
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');

/** Isolated dist so LHCI never races `next dev` on web/.next. */
const DIST_DIR_NAME = process.env.NEXT_DIST_DIR || '.next-lhci';
const PORT = String(process.env.LHCI_PORT || '3011');
const BASE_URL = `http://127.0.0.1:${PORT}`;

function log(msg) {
  process.stderr.write(`[lighthouse-ci] ${msg}\n`);
}

function cpRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function ensureJwtPublicKey() {
  if (process.env.JWT_PUBLIC_KEY_PATH) {
    const p = process.env.JWT_PUBLIC_KEY_PATH;
    if (!fs.existsSync(p)) {
      throw new Error(`JWT_PUBLIC_KEY_PATH set but file missing: ${p}`);
    }
    return p;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomarkup-lhci-'));
  const privatePath = path.join(dir, 'private.pem');
  const publicPath = path.join(dir, 'public.pem');

  const gen = spawnSync('openssl', ['genrsa', '-out', privatePath, '2048'], {
    stdio: 'pipe',
  });
  if (gen.status !== 0) {
    throw new Error(
      `openssl genrsa failed: ${gen.stderr?.toString() || gen.error}`,
    );
  }
  const pub = spawnSync(
    'openssl',
    ['rsa', '-in', privatePath, '-pubout', '-out', publicPath],
    { stdio: 'pipe' },
  );
  if (pub.status !== 0) {
    throw new Error(
      `openssl rsa -pubout failed: ${pub.stderr?.toString() || pub.error}`,
    );
  }
  log(`minted throwaway JWT public key at ${publicPath}`);
  return publicPath;
}

function resolveChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  try {
    let chromium;
    try {
      ({ chromium } = require('playwright'));
    } catch {
      ({ chromium } = require('@playwright/test'));
    }
    const p = chromium?.executablePath?.();
    if (p && fs.existsSync(p)) {
      log(`using Playwright Chromium: ${p}`);
      return p;
    }
  } catch {
    // chrome-launcher will search the system
  }

  log(
    'CHROME_PATH unset; chrome-launcher will search for system Chrome/Chromium',
  );
  return undefined;
}

function distRoot() {
  return path.join(webRoot, DIST_DIR_NAME);
}

function ensureProductionBuild() {
  const buildId = path.join(distRoot(), 'BUILD_ID');
  if (process.env.LHCI_SKIP_BUILD === '1') {
    if (!fs.existsSync(buildId)) {
      throw new Error(
        `LHCI_SKIP_BUILD=1 but ${DIST_DIR_NAME}/BUILD_ID is missing — run without skip or set LHCI_FORCE_BUILD=1`,
      );
    }
    log(`LHCI_SKIP_BUILD=1 — reusing ${DIST_DIR_NAME}`);
    return;
  }
  if (fs.existsSync(buildId) && process.env.LHCI_FORCE_BUILD !== '1') {
    log(
      `found ${DIST_DIR_NAME} — skipping build (set LHCI_FORCE_BUILD=1 to rebuild)`,
    );
    return;
  }

  log(`running production next build → ${DIST_DIR_NAME}…`);
  const r = spawnSync('npm', ['run', 'build'], {
    cwd: webRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_DIST_DIR: DIST_DIR_NAME,
    },
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 2);
  }
}

/**
 * next.config uses `output: 'standalone'`. Prepare the standalone tree the
 * same way deploy/docker/web.Dockerfile does (static + public next to server.js).
 */
function prepareStandalone() {
  const standalone = path.join(distRoot(), 'standalone');
  const serverJs = path.join(standalone, 'server.js');
  if (!fs.existsSync(serverJs)) {
    throw new Error(
      `standalone server missing at ${serverJs} — production build incomplete`,
    );
  }

  const staticSrc = path.join(distRoot(), 'static');
  const staticDest = path.join(standalone, DIST_DIR_NAME, 'static');
  // Standalone server expects static assets under `.next/static` relative to
  // its cwd **using the default dist name**, OR under the custom distDir name
  // when distDir was customized. Next 15 standalone with custom distDir nests
  // manifests under standalone/<distDirName>/. Mirror both static placements
  // that Docker uses (always `.next/static` in the image) AND custom distDir.
  if (!fs.existsSync(staticSrc)) {
    throw new Error(`missing static assets at ${staticSrc}`);
  }
  cpRecursive(staticSrc, staticDest);
  // Docker image path: runner WORKDIR has `.next/static` next to server.js
  // when distDir is default. With custom distDir the server looks under
  // `<distDir>/static`. Also copy classic `.next/static` for safety.
  cpRecursive(staticSrc, path.join(standalone, '.next', 'static'));

  const publicSrc = path.join(webRoot, 'public');
  if (fs.existsSync(publicSrc)) {
    cpRecursive(publicSrc, path.join(standalone, 'public'));
  }

  log(`standalone ready at ${standalone}`);
  return standalone;
}

/**
 * Write a one-shot lighthouserc overlay so collect URLs / start command match
 * LHCI_PORT without editing the checked-in config by hand.
 */
function writeRuntimeConfig(standaloneDir) {
  const baseConfigPath = path.join(webRoot, 'lighthouserc.cjs');
  // Re-require each run so edits are picked up.
  delete require.cache[require.resolve(baseConfigPath)];
  const base = require(baseConfigPath);

  const urls = ['/', '/marketplace', '/jobs'].map((p) => `${BASE_URL}${p === '/' ? '/' : p}`);

  // node server.js — HOSTNAME/PORT are Next standalone conventions.
  const startCmd = `node ${JSON.stringify(path.join(standaloneDir, 'server.js'))}`;

  const runtime = {
    ...base,
    ci: {
      ...base.ci,
      collect: {
        ...base.ci.collect,
        startServerCommand: startCmd,
        startServerReadyPattern:
          base.ci.collect.startServerReadyPattern || 'Ready',
        url: urls,
        numberOfRuns: Number(
          process.env.LHCI_NUMBER_OF_RUNS ||
            base.ci.collect.numberOfRuns ||
            1,
        ),
      },
    },
  };

  const outPath = path.join(webRoot, 'lighthouserc.runtime.cjs');
  const body = `/** Auto-generated by scripts/run-lighthouse-ci.mjs — do not commit. */\nmodule.exports = ${JSON.stringify(runtime, null, 2)};\n`;
  fs.writeFileSync(outPath, body, 'utf8');
  log(`wrote runtime config ${outPath} (port ${PORT})`);
  return outPath;
}

function main() {
  process.chdir(webRoot);

  process.env.NEXT_DIST_DIR = DIST_DIR_NAME;
  process.env.PORT = PORT;
  process.env.HOSTNAME = process.env.HOSTNAME || '127.0.0.1';

  // Production boot requirements (web/src/lib/server/env.ts). Placeholders only.
  const defaults = {
    NODE_ENV: 'production',
    API_URL: process.env.API_URL || 'http://127.0.0.1:8080',
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL ||
      process.env.API_URL ||
      'http://127.0.0.1:8080',
    NEXT_PUBLIC_SITE_URL:
      process.env.NEXT_PUBLIC_SITE_URL || BASE_URL,
    NEXT_PUBLIC_MAPBOX_TOKEN:
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
      'pk.lhci_placeholder_not_a_real_token',
    NEXT_PUBLIC_WS_URL:
      process.env.NEXT_PUBLIC_WS_URL || 'ws://127.0.0.1:8080',
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (!process.env[k]) process.env[k] = v;
  }

  process.env.JWT_PUBLIC_KEY_PATH = ensureJwtPublicKey();

  const chrome = resolveChromePath();
  if (chrome) process.env.CHROME_PATH = chrome;

  ensureProductionBuild();
  const standaloneDir = prepareStandalone();
  const configPath = writeRuntimeConfig(standaloneDir);

  // Standalone server resolves modules from its own directory.
  process.env.LHCI_STANDALONE_DIR = standaloneDir;

  const lhciBin = path.join(webRoot, 'node_modules', '.bin', 'lhci');
  if (!fs.existsSync(lhciBin)) {
    log('error: @lhci/cli not installed — run npm ci in web/');
    process.exit(2);
  }

  log(`starting lhci autorun against ${BASE_URL}…`);
  const result = spawnSync(
    lhciBin,
    ['autorun', `--config=${configPath}`],
    {
      cwd: webRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        // Ensure the child startServerCommand sees the same boot env.
        PORT,
        HOSTNAME: process.env.HOSTNAME,
        NODE_ENV: 'production',
      },
    },
  );

  process.exit(result.status ?? 2);
}

main();
