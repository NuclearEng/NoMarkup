#!/usr/bin/env node
/**
 * FE-03 — ban arbitrary raw hex colors in web components / app routes.
 *
 * Scans web/src/components and web/src/app for #RGB / #RRGGBB / #RRGGBBAA
 * outside the allowlist (web/scripts/raw-hex-allowlist.txt).
 *
 * Allowed by design (not scanned):
 *   - web/src/styles/globals.css, tailwind.config.ts (token SSOT)
 *   - paths listed in raw-hex-allowlist.txt (Mapbox, OAuth brand, OG icons, themeColor)
 *
 * Usage:
 *   node web/scripts/check-no-raw-hex.mjs
 *   npm run check:hex   # from web/
 *
 * Exit: 0 clean · 1 violations · 2 usage/IO error
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, '..');
const ALLOWLIST_PATH = path.join(__dirname, 'raw-hex-allowlist.txt');
const SCAN_ROOTS = [
  path.join(WEB_DIR, 'src', 'components'),
  path.join(WEB_DIR, 'src', 'app'),
];
const EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

/** Hex color not part of HTML entity (&#…;) or identifier. */
const HEX_RE = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/;

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    console.error(`error: missing allowlist ${ALLOWLIST_PATH}`);
    process.exit(2);
  }
  const allowed = new Set();
  for (const raw of fs.readFileSync(ALLOWLIST_PATH, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    allowed.add(line.replace(/\\/g, '/'));
  }
  return allowed;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) {
    console.error(`error: scan root missing: ${dir}`);
    process.exit(2);
  }
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full, out);
    } else if (ent.isFile() && EXT.has(path.extname(ent.name))) {
      out.push(full);
    }
  }
  return out;
}

function isSkippableLine(trimmed) {
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*')
  );
}

function main() {
  const allowed = loadAllowlist();
  const hits = [];

  for (const root of SCAN_ROOTS) {
    for (const file of walk(root)) {
      const rel = path.relative(WEB_DIR, file).split(path.sep).join('/');
      if (allowed.has(rel)) continue;

      const text = fs.readFileSync(file, 'utf8');
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const trimmed = line.trimStart();
        if (isSkippableLine(trimmed)) continue;
        // Drop trailing // comments (naive; good enough for color ban)
        const code = line.replace(/\/\/.*$/, '');
        if (HEX_RE.test(code)) {
          hits.push(`${rel}:${String(i + 1)}:${line}`);
        }
      }
    }
  }

  if (hits.length > 0) {
    console.error(
      `FE-03 raw hex ban: ${String(hits.length)} hit(s) in web/src/{components,app}`,
    );
    console.error(
      'Use CSS vars (var(--brand-green), var(--background), …) or Tailwind tokens.',
    );
    console.error(
      'Intentional exceptions go in web/scripts/raw-hex-allowlist.txt + docs/design-system.md.',
    );
    console.error('');
    for (const h of hits) {
      console.error(`  ${h}`);
    }
    process.exit(1);
  }

  console.log(
    'FE-03 raw hex ban: OK (no arbitrary hex in components/app outside allowlist)',
  );
}

main();
