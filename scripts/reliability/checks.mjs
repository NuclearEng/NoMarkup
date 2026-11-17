#!/usr/bin/env node
// Automated checks behind the `Run:` lines of docs/reliability-checklist.md.
//
//   node scripts/reliability/checks.mjs <check> [--root <repo>]
//
// Each check prints one line per problem and exits 1 when it finds any, 0
// otherwise. Checks never print file contents from a diff (one of them looks
// for secret-shaped strings), only paths, line numbers and names.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectDiff, git } from './lib.mjs';

const read = (root, p) => readFileSync(join(root, p), 'utf8');

function walk(root, dir, out = [], skip = new Set(['node_modules', '.git', 'target', '.next', 'DerivedData'])) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (skip.has(name) || name.startsWith('.next')) continue;
    const rel = dir ? `${dir}/${name}` : name;
    const st = statSync(join(root, rel));
    if (st.isDirectory()) walk(root, rel, out, skip);
    else out.push(rel);
  }
  return out;
}

const dockerfiles = (root) =>
  existsSync(join(root, 'deploy/docker'))
    ? readdirSync(join(root, 'deploy/docker'))
        .filter((f) => f.endsWith('.Dockerfile') || f === 'Dockerfile')
        .map((f) => `deploy/docker/${f}`)
    : [];

/** Paths a Dockerfile line copies from the build context ([] for --from= copies). */
function copySources(line) {
  const m = /^\s*(?:COPY|ADD)\s+(.*)$/i.exec(line);
  if (!m) return [];
  const words = m[1].trim().split(/\s+/).filter((w) => !w.startsWith('--chown') && !w.startsWith('--chmod') && !w.startsWith('--link'));
  if (m[1].includes('--from=')) return [];
  if (words.length < 2) return [];
  return words.slice(0, -1).map((w) => normalize(w).replace(/\/$/, ''));
}

const covers = (sources, path) =>
  sources.some((s) => s === '.' || s === path || path.startsWith(`${s}/`));

function goReplaceTargets(root, moduleDir) {
  const gomod = join(root, moduleDir, 'go.mod');
  if (!existsSync(gomod)) return [];
  const out = [];
  for (const line of readFileSync(gomod, 'utf8').split('\n')) {
    const m = /=>\s*(\.{1,2}\/\S+)/.exec(line);
    if (m) out.push(normalize(join(moduleDir, m[1])));
  }
  return out;
}

function cargoMembers(root) {
  const p = join(root, 'engines/Cargo.toml');
  if (!existsSync(p)) return [];
  const m = /members\s*=\s*\[([^\]]*)\]/s.exec(readFileSync(p, 'utf8'));
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/**
 * every local module a build stage needs is in the image
 * before the first `go` / `cargo` command of that stage runs.
 */
export function checkDockerContext(root) {
  const problems = [];
  for (const df of dockerfiles(root)) {
    let sources = [];
    let modules = [];
    let goChecked = false;
    let cargoChecked = false;
    for (const line of read(root, df).split('\n')) {
      if (/^\s*FROM\s/i.test(line)) {
        sources = [];
        modules = [];
        goChecked = false;
        cargoChecked = false;
        continue;
      }
      const src = copySources(line);
      if (src.length) {
        sources.push(...src);
        for (const s of src) {
          if (s.endsWith('/go.mod')) modules.push(dirname(s));
        }
        continue;
      }
      if (!/^\s*RUN\s/i.test(line)) continue;
      if (!goChecked && /\bgo\s+(mod|build|install|vet|test)\b/.test(line) && modules.length) {
        goChecked = true;
        for (const mod of modules) {
          for (const target of goReplaceTargets(root, mod)) {
            if (!covers(sources, target)) {
              problems.push(`${df}: ${mod}/go.mod replaces a module at ${target}, which is not copied before \`go\` runs`);
            }
          }
        }
      }
      if (!cargoChecked && /\bcargo\s/.test(line) && covers(sources, 'engines/Cargo.toml')) {
        cargoChecked = true;
        for (const member of cargoMembers(root)) {
          if (!covers(sources, `engines/${member}/Cargo.toml`)) {
            problems.push(`${df}: workspace member engines/${member} is not copied before \`cargo\` runs`);
          }
        }
      }
    }
  }
  return problems;
}

/** go.mod toolchains, workflow GO_VERSION and golang images agree. */
export function checkGoToolchain(root) {
  const seen = [];
  for (const f of walk(root, '')) {
    if (f.endsWith('go.mod')) {
      const m = /^toolchain\s+go(\S+)/m.exec(read(root, f));
      if (m) seen.push([f, m[1]]);
    }
  }
  const wfDir = '.github/workflows';
  if (existsSync(join(root, wfDir))) {
    for (const f of readdirSync(join(root, wfDir))) {
      const m = /^\s*GO_VERSION:\s*["']?([0-9.]+)["']?/m.exec(read(root, `${wfDir}/${f}`));
      if (m) seen.push([`${wfDir}/${f}`, m[1]]);
    }
  }
  for (const df of dockerfiles(root)) {
    for (const m of read(root, df).matchAll(/^\s*FROM\s+golang:([0-9.]+)/gim)) seen.push([df, m[1]]);
  }
  const versions = new Set(seen.map(([, v]) => v));
  if (versions.size <= 1) return [];
  return [`Go versions disagree (${[...versions].join(', ')}):`, ...seen.map(([f, v]) => `  ${v}  ${f}`)];
}

/** every Go module (except generated stubs) has its tests run in CI. */
export function checkGoModulesInCi(root) {
  const ci = existsSync(join(root, '.github/workflows/ci.yml')) ? read(root, '.github/workflows/ci.yml') : '';
  const matrix = /service:\s*\[([^\]]+)\]/.exec(ci);
  const matrixServices = matrix ? matrix[1].split(',').map((s) => s.trim()) : [];
  const matrixRunsTests = ci.includes('services/${{ matrix.service }}') && /go test/.test(ci);
  const problems = [];
  for (const f of walk(root, '')) {
    if (!f.endsWith('/go.mod')) continue;
    const dir = dirname(f);
    if (dir === 'proto/gen/go') continue; // generated; vetted by `make verify-proto`
    const tested = ci
      .split('\n')
      .some((l) => (l.includes(`cd ${dir} `) || l.includes(`cd "${dir}"`) || l.includes(`working-directory: ${dir}`)) && l.includes('go test'));
    const viaMatrix = dir.startsWith('services/') && matrixServices.includes(dir.slice('services/'.length)) && matrixRunsTests;
    if (!tested && !viaMatrix) problems.push(`${dir}: no job in .github/workflows/ci.yml runs \`go test\` for this module`);
  }
  return problems;
}

/** Split a workflow file into {name, body} per job (two-space indented keys under `jobs:`). */
export function workflowJobs(text) {
  const jobs = [];
  let inJobs = false;
  let cur = null;
  for (const line of text.split('\n')) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^\S/.test(line) && !line.startsWith('#')) {
      inJobs = false;
      cur = null;
      continue;
    }
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      cur = { name: m[1], body: '' };
      jobs.push(cur);
      continue;
    }
    if (cur) cur.body += `${line}\n`;
  }
  return jobs;
}

const workflows = (root) =>
  existsSync(join(root, '.github/workflows'))
    ? readdirSync(join(root, '.github/workflows'))
        .filter((f) => /\.ya?ml$/.test(f))
        .map((f) => `.github/workflows/${f}`)
    : [];

/** jobs that install Playwright browsers do not float on ubuntu-latest. */
export function checkPlaywrightRunners(root) {
  const problems = [];
  for (const wf of workflows(root)) {
    for (const job of workflowJobs(read(root, wf))) {
      if (!/playwright install/.test(job.body)) continue;
      const runsOn = /^\s{4}runs-on:\s*(\S+)/m.exec(job.body);
      if (!runsOn || runsOn[1] === 'ubuntu-latest') {
        problems.push(`${wf}: job ${job.name} installs Playwright browsers on ${runsOn ? runsOn[1] : 'an unset runner'}; pin the newest image the locked Playwright supports`);
      }
    }
  }
  return problems;
}

/** a job that builds image names from IMAGE_PREFIX lowercases it first. */
export function checkImagePrefixLowercase(root) {
  const problems = [];
  const lower = /\[:upper:\]['"]?\s+['"]?\[:lower:\]|tr\s+['"]?A-Z['"]?\s+['"]?a-z|\$\{IMAGE_PREFIX,,\}/;
  for (const wf of workflows(root)) {
    for (const job of workflowJobs(read(root, wf))) {
      const uses = /\$\{?IMAGE_PREFIX\}?\//.test(job.body);
      if (uses && !lower.test(job.body)) {
        problems.push(`${wf}: job ${job.name} builds an image reference from IMAGE_PREFIX without lowercasing it (registry names must be lowercase; the owner login is not)`);
      }
    }
  }
  return problems;
}

/** every up migration has a down and vice versa. */
export function checkMigrationPairs(root) {
  const dir = 'database/migrations';
  if (!existsSync(join(root, dir))) return [];
  const seen = new Map();
  for (const f of readdirSync(join(root, dir))) {
    const m = /^(\d+_.+)\.(up|down)\.sql$/.exec(f);
    if (!m) continue;
    const s = seen.get(m[1]) ?? new Set();
    s.add(m[2]);
    seen.set(m[1], s);
  }
  const problems = [];
  for (const [name, kinds] of seen) {
    for (const k of ['up', 'down']) {
      if (!kinds.has(k)) problems.push(`${dir}/${name}.${k}.sql is missing`);
    }
  }
  return problems.sort();
}

const webSource = (root) => walk(root, 'web/src').filter((f) => /\.(ts|tsx|js|jsx|mjs|css)$/.test(f));

/** fonts are self-hosted; nothing fetches Google Fonts at build or dev start. */
export function checkNoGoogleFonts(root) {
  const problems = [];
  for (const f of webSource(root)) {
    read(root, f)
      .split('\n')
      .forEach((l, i) => {
        if (/['"]next\/font\/google['"]|https?:\/\/fonts\.(?:googleapis|gstatic)\.com/.test(l)) problems.push(`${f}:${i + 1}: fetches Google Fonts`);
      });
  }
  return problems;
}

/** NEXT_PUBLIC_SITE_URL is read through siteUrl() only. */
export function checkSiteUrl(root) {
  const allowed = new Set(['web/src/lib/site-url.ts', 'web/src/lib/server/env.ts']);
  const problems = [];
  for (const f of webSource(root)) {
    if (allowed.has(f)) continue;
    read(root, f)
      .split('\n')
      .forEach((l, i) => {
        if (l.includes('NEXT_PUBLIC_SITE_URL')) problems.push(`${f}:${i + 1}: reads NEXT_PUBLIC_SITE_URL directly; use siteUrl() from @/lib/site-url (an empty value breaks new URL() at build)`);
      });
  }
  return problems;
}

/** client code imports per-domain schemas and zod/mini, never the barrel or classic zod. */
export function checkZodImports(root) {
  const problems = [];
  const serverOnly = (f) => f.startsWith('web/src/app/api/') || f.startsWith('web/src/lib/server/');
  for (const f of webSource(root)) {
    if (f === 'web/src/lib/validations.ts') continue;
    read(root, f)
      .split('\n')
      .forEach((l, i) => {
        if (/from\s+['"]@\/lib\/validations['"]/.test(l)) {
          problems.push(`${f}:${i + 1}: imports the @/lib/validations barrel; import from @/lib/schemas/<domain>`);
        }
        if (/from\s+['"]zod(\/v[34])?['"]/.test(l) && !serverOnly(f)) {
          problems.push(`${f}:${i + 1}: imports classic zod into code that can reach a client bundle; use @/lib/zod-mini`);
        }
      });
  }
  return problems;
}

/** every committed xcconfig is referenced by the Xcode project. */
export function checkXcconfigWired(root) {
  const dir = 'ios/Config';
  const pbx = 'ios/NoMarkup.xcodeproj/project.pbxproj';
  if (!existsSync(join(root, dir)) || !existsSync(join(root, pbx))) return [];
  const project = read(root, pbx);
  const problems = [];
  for (const f of readdirSync(join(root, dir))) {
    if (!f.endsWith('.xcconfig') || f.startsWith('Secrets')) continue;
    if (!project.includes(`path = ${f};`)) problems.push(`${dir}/${f} is not referenced by ${pbx}; its build settings never apply`);
  }
  if (!/baseConfigurationReference = \w+ \/\* \w+\.xcconfig \*\//.test(project)) {
    problems.push(`${pbx}: no build configuration uses an xcconfig as its base configuration`);
  }
  return problems;
}

const SECRET_SHAPES = [
  ['Stripe secret/restricted/publishable key', /\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{8,}/],
  ['Stripe webhook secret', /\bwhsec_[0-9A-Za-z]{8,}/],
];

/** no added line carries a literal Stripe-shaped credential (prints location only). */
export function checkSecretShapes(root, base) {
  const { files } = collectDiff({ cwd: root, base });
  const problems = [];
  for (const f of files) {
    for (const { line, text } of f.added) {
      for (const [kind, re] of SECRET_SHAPES) {
        if (re.test(text)) problems.push(`${f.path}:${line}: added line contains a literal ${kind}; build fixtures from parts at runtime`);
      }
    }
  }
  return problems;
}

export const CHECKS = {
  'docker-context': (root) => checkDockerContext(root),
  'go-toolchain': (root) => checkGoToolchain(root),
  'go-modules-in-ci': (root) => checkGoModulesInCi(root),
  'playwright-runners': (root) => checkPlaywrightRunners(root),
  'image-prefix-lowercase': (root) => checkImagePrefixLowercase(root),
  'migration-pairs': (root) => checkMigrationPairs(root),
  'no-google-fonts': (root) => checkNoGoogleFonts(root),
  'site-url': (root) => checkSiteUrl(root),
  'zod-imports': (root) => checkZodImports(root),
  'xcconfig-wired': (root) => checkXcconfigWired(root),
  'secret-shapes': (root) => checkSecretShapes(root, process.env.RC_BASE || 'origin/main'),
};

function main(argv) {
  const name = argv[0];
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
  if (!name || !CHECKS[name]) {
    process.stderr.write(`usage: checks.mjs <${Object.keys(CHECKS).join('|')}> [--root <repo>]\n`);
    return 2;
  }
  const problems = CHECKS[name](root);
  for (const p of problems) process.stdout.write(`${p}\n`);
  if (problems.length === 0) process.stdout.write(`${name}: ok\n`);
  return problems.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}

