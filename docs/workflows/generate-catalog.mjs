/**
 * Catalog SSOT: docs/workflows/catalog.yaml → catalog.json
 * Also enumerates App Router pages into pages.json.
 *
 *   node docs/workflows/generate-catalog.mjs           # write both
 *   node docs/workflows/generate-catalog.mjs --check   # fail if catalog.json is stale
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const yamlPath = join(here, 'catalog.yaml');
const jsonPath = join(here, 'catalog.json');
const pagesOut = join(here, 'pages.json');
const appDir = join(root, 'web/src/app');

const CHECK = process.argv.includes('--check');

// ── Minimal YAML parser for this catalog schema (maps / lists / scalars) ──

function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s.startsWith('[') && s.endsWith(']')) return parseInlineList(s);
  if (s.startsWith('{') && s.endsWith('}')) return parseInlineMap(s);
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  return s;
}

function splitTopLevel(inner, sep) {
  const parts = [];
  let buf = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') depth--;
      else if (ch === sep && depth === 0) {
        parts.push(buf);
        buf = '';
        continue;
      }
    }
    buf += ch;
  }
  if (buf.length > 0 || parts.length > 0) parts.push(buf);
  return parts;
}

function parseInlineList(s) {
  const inner = s.slice(1, -1).trim();
  if (inner === '') return [];
  return splitTopLevel(inner, ',').map((p) => parseScalar(p.trim()));
}

function parseInlineMap(s) {
  const inner = s.slice(1, -1).trim();
  if (inner === '') return {};
  const out = {};
  for (const part of splitTopLevel(inner, ',')) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    out[k] = parseScalar(part.slice(idx + 1));
  }
  return out;
}

function splitKeyValue(content) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ':' && !inSingle && !inDouble) {
      const after = content.slice(i + 1);
      if (after.length === 0 || after.startsWith(' ') || after.startsWith('\t')) {
        return { key: content.slice(0, i).trim(), rest: after.trim() };
      }
    }
  }
  return { key: content.trim(), rest: '' };
}

/**
 * Zero-dependency YAML subset: comments, indent maps, block lists of maps,
 * inline lists/maps, scalars (string / int / bool / null).
 */
export function parseMinimalYaml(text) {
  const rawLines = text.split(/\r?\n/);
  const rows = [];
  for (const raw of rawLines) {
    const stripped = stripComment(raw);
    if (stripped.trim() === '') continue;
    const indent = stripped.length - stripped.trimStart().length;
    rows.push({ indent, content: stripped.trim() });
  }

  const root = {};
  const stack = [{ indent: -1, container: root, kind: 'map' }];

  for (let i = 0; i < rows.length; i++) {
    const { indent, content } = rows[i];
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const frame = stack[stack.length - 1];

    if (content.startsWith('- ')) {
      const itemRaw = content.slice(2);
      let list = frame.container;
      if (!Array.isArray(list)) {
        if (frame.kind === 'map' && frame.pendingKey) {
          list = [];
          frame.container[frame.pendingKey] = list;
          frame.pendingKey = undefined;
          stack.push({ indent, container: list, kind: 'list' });
        } else {
          throw new Error(`YAML list item without list parent: ${content}`);
        }
      }
      const listFrame = stack[stack.length - 1];
      if (itemRaw.includes(':')) {
        const { key, rest } = splitKeyValue(itemRaw);
        const obj = {};
        if (rest === '') {
          obj[key] = null;
          listFrame.container.push(obj);
          stack.push({ indent, container: obj, kind: 'map', pendingKey: key });
        } else {
          obj[key] = parseScalar(rest);
          listFrame.container.push(obj);
          stack.push({ indent, container: obj, kind: 'map' });
        }
      } else {
        listFrame.container.push(parseScalar(itemRaw));
      }
      continue;
    }

    const { key, rest } = splitKeyValue(content);
    if (frame.kind !== 'map') {
      throw new Error(`YAML map key inside non-map: ${content}`);
    }
    if (rest === '') {
      const next = rows[i + 1];
      if (next && next.indent > indent) {
        const nested = next.content.startsWith('- ') ? [] : {};
        frame.container[key] = nested;
        stack.push({
          indent,
          container: nested,
          kind: Array.isArray(nested) ? 'list' : 'map',
        });
      } else {
        frame.container[key] = null;
      }
      frame.pendingKey = undefined;
    } else {
      frame.container[key] = parseScalar(rest);
      frame.pendingKey = undefined;
    }
  }

  return root;
}

function workflowOut(raw) {
  const w = {
    id: raw.id,
    label: raw.label,
    web: raw.web,
    method: raw.method ?? null,
    path: raw.path ?? null,
    status: raw.status ?? null,
  };
  if (raw.ios !== undefined && raw.ios !== null) w.ios = raw.ios;
  if (raw.mutation === true) w.mutation = true;
  if (typeof raw.persona === 'string' && raw.persona.length > 0) w.persona = raw.persona;
  if (raw.deny && typeof raw.deny === 'object') w.deny = raw.deny;
  if (typeof raw.vcr === 'string' && raw.vcr.length > 0) w.vcr = raw.vcr;
  return w;
}

export function catalogFromYamlDoc(doc) {
  const workflows = Array.isArray(doc.workflows) ? doc.workflows.map(workflowOut) : [];
  return {
    version: doc.version ?? 1,
    personas: doc.personas ?? [],
    workflows,
  };
}

export function renderCatalogJson(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function walkPages(dir, acc = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walkPages(p, acc);
    else if (ent.name === 'page.tsx') acc.push(p);
  }
  return acc;
}

function writePagesJson() {
  const files = walkPages(appDir);
  const routes = files.map((f) => {
    let rel = relative(appDir, f).replace(/\\/g, '/').replace(/\/page\.tsx$/, '');
    rel = rel
      .replace(/^\(public\)\//, '')
      .replace(/^\(dashboard\)\//, '')
      .replace(/^\(auth\)\//, '')
      .replace(/^\(terminal\)\//, '');
    const route = rel === '' || rel === '(public)' ? '/' : `/${rel}`;
    return {
      id: `web.page.${route.replace(/\//g, '.').replace(/^\./, '') || 'home'}`,
      route,
      file: relative(root, f),
    };
  });
  writeFileSync(
    pagesOut,
    `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), routes }, null, 2)}\n`,
  );
  return routes.length;
}

function main() {
  const yamlText = readFileSync(yamlPath, 'utf8');
  const doc = parseMinimalYaml(yamlText);
  const catalog = catalogFromYamlDoc(doc);
  const rendered = renderCatalogJson(catalog);

  if (CHECK) {
    let existing = '';
    try {
      existing = readFileSync(jsonPath, 'utf8');
    } catch {
      existing = '';
    }
    if (existing !== rendered) {
      console.error('catalog.json is stale vs catalog.yaml; run: node docs/workflows/generate-catalog.mjs');
      process.exit(1);
    }
    console.log(`catalog.json ok (${catalog.workflows.length} workflows)`);
    return;
  }

  writeFileSync(jsonPath, rendered);
  console.log(`wrote ${catalog.workflows.length} workflows → ${relative(root, jsonPath)}`);
  const n = writePagesJson();
  console.log(`wrote ${n} routes → ${relative(root, pagesOut)}`);
}

const isMain =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}
