/**
 * Enumerate App Router pages into catalog.yaml web.page.* entries.
 * Usage: node docs/workflows/generate-catalog.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const appDir = join(process.cwd(), 'web/src/app');
const out = join(process.cwd(), 'docs/workflows/pages.json');

function walk(dir, acc = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name === 'page.tsx') acc.push(p);
  }
  return acc;
}

const files = walk(appDir);
const routes = files.map((f) => {
  let rel = relative(appDir, f).replace(/\\/g, '/').replace(/\/page\.tsx$/, '');
  rel = rel.replace(/^\(public\)\//, '').replace(/^\(dashboard\)\//, '').replace(/^\(auth\)\//, '').replace(/^\(terminal\)\//, '');
  const route = rel === '' || rel === '(public)' ? '/' : `/${rel}`;
  return { id: `web.page.${route.replace(/\//g, '.').replace(/^\./, '') || 'home'}`, route, file: relative(process.cwd(), f) };
});

writeFileSync(out, `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), routes }, null, 2)}\n`);
console.log(`wrote ${routes.length} routes → ${out}`);
