// node --test scripts/reliability/checks.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CHECKS,
  checkDockerContext,
  checkGoModulesInCi,
  checkGoToolchain,
  checkImagePrefixLowercase,
  checkMigrationPairs,
  checkNoGoogleFonts,
  checkPlaywrightFixedEngine,
  checkPlaywrightRunners,
  checkSecretShapes,
  checkSiteUrl,
  checkXcconfigWired,
  checkZodImports,
  workflowJobs,
} from './checks.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'rc-check-'));
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), content);
  }
  return root;
}

const GATEWAY_GOMOD = 'module x\n\ngo 1.26.0\n\ntoolchain go1.26.11\n\nreplace github.com/x/proto => ../proto/gen/go\nreplace github.com/x/pkg/grpmtls => ../pkg/grpmtls\n';

test('docker-context: a replace target copied after `go mod download` is a problem', () => {
  const good = fixture({
    'gateway/go.mod': GATEWAY_GOMOD,
    'deploy/docker/gateway.Dockerfile': 'FROM golang:1.26.11-alpine AS builder\nCOPY proto/gen/go/ proto/gen/go/\nCOPY pkg/grpmtls/ pkg/grpmtls/\nCOPY gateway/go.mod gateway/go.sum gateway/\nRUN go mod download\nCOPY gateway/ /app/gateway/\nFROM alpine:3.20\nCOPY --from=builder /gateway /gateway\n',
  });
  assert.deepEqual(checkDockerContext(good), []);

  const bad = fixture({
    'gateway/go.mod': GATEWAY_GOMOD,
    'deploy/docker/gateway.Dockerfile': 'FROM golang:1.26.11-alpine AS builder\nCOPY proto/ proto/\nCOPY gateway/go.mod gateway/go.sum gateway/\nRUN go mod download\nCOPY pkg/grpmtls/ pkg/grpmtls/\n',
  });
  const problems = checkDockerContext(bad);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /pkg\/grpmtls/);
});

test('docker-context: every Cargo workspace member is copied before cargo runs', () => {
  const cargo = '[workspace]\nmembers = [\n  "telemetry",\n  "bidding",\n]\n';
  const bad = fixture({
    'engines/Cargo.toml': cargo,
    'deploy/docker/engines.Dockerfile': 'FROM rust:1 AS builder\nCOPY engines/Cargo.toml engines/Cargo.lock engines/\nCOPY engines/bidding/Cargo.toml engines/bidding/\nRUN cargo fetch\nCOPY engines/ /app/engines/\n',
  });
  assert.deepEqual(checkDockerContext(bad), ['deploy/docker/engines.Dockerfile: workspace member engines/telemetry is not copied before `cargo` runs']);
  const good = fixture({
    'engines/Cargo.toml': cargo,
    'deploy/docker/engines.Dockerfile': 'FROM rust:1 AS builder\nCOPY engines/Cargo.toml engines/Cargo.lock engines/\nCOPY engines/telemetry/Cargo.toml engines/telemetry/\nCOPY engines/bidding/Cargo.toml engines/bidding/\nRUN cargo fetch\n',
  });
  assert.deepEqual(checkDockerContext(good), []);
});

test('go-toolchain: one disagreeing pin is reported with every source', () => {
  const root = fixture({
    'gateway/go.mod': GATEWAY_GOMOD,
    '.github/workflows/ci.yml': 'env:\n  GO_VERSION: "1.26.11"\n',
    'deploy/docker/user.Dockerfile': 'FROM golang:1.26.10-alpine AS builder\n',
  });
  const problems = checkGoToolchain(root);
  assert.match(problems[0], /1\.26\.11, 1\.26\.10|1\.26\.10, 1\.26\.11/);
  assert.ok(problems.some((p) => p.includes('deploy/docker/user.Dockerfile')));
  assert.deepEqual(checkGoToolchain(fixture({ 'gateway/go.mod': GATEWAY_GOMOD, '.github/workflows/ci.yml': 'env:\n  GO_VERSION: "1.26.11"\n' })), []);
});

test('go-modules-in-ci: direct cd steps and the services matrix count; others do not', () => {
  const ci = [
    'jobs:',
    '  gateway-test:',
    '    steps:',
    '      - run: cd gateway && go test ./... -race',
    '  services-test:',
    '    strategy:',
    '      matrix:',
    '        service: [user, job]',
    '    steps:',
    '      - run: cd "services/${{ matrix.service }}" && go test ./...',
  ].join('\n');
  const root = fixture({
    '.github/workflows/ci.yml': ci,
    'gateway/go.mod': 'module g\n',
    'services/user/go.mod': 'module u\n',
    'services/chat/go.mod': 'module c\n',
    'pkg/grpmtls/go.mod': 'module m\n',
    'proto/gen/go/go.mod': 'module p\n',
  });
  assert.deepEqual(checkGoModulesInCi(root).sort(), [
    'pkg/grpmtls: no job in .github/workflows/ci.yml runs `go test` for this module',
    'services/chat: no job in .github/workflows/ci.yml runs `go test` for this module',
  ]);
});

test('workflowJobs splits jobs and stops at the next top-level key', () => {
  const jobs = workflowJobs('on: push\njobs:\n  a:\n    runs-on: x\n  b:\n    runs-on: y\n# comment\nfoo: bar\n');
  assert.deepEqual(jobs.map((j) => j.name), ['a', 'b']);
});

test('playwright-runners: ubuntu-latest with a browser install fails, a pinned image passes', () => {
  const bad = fixture({ '.github/workflows/ci.yml': 'jobs:\n  e2e:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx playwright install --with-deps chromium\n  unit:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n' });
  assert.equal(checkPlaywrightRunners(bad).length, 1);
  assert.match(checkPlaywrightRunners(bad)[0], /job e2e/);
  const good = fixture({ '.github/workflows/ci.yml': 'jobs:\n  e2e:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npx playwright install --with-deps chromium\n' });
  assert.deepEqual(checkPlaywrightRunners(good), []);
});

test('image-prefix-lowercase: a tag built from IMAGE_PREFIX needs a lowercase step in the same job', () => {
  const bad = fixture({ '.github/workflows/ci.yml': 'jobs:\n  build:\n    steps:\n      - run: |\n          tag="${REGISTRY}/${IMAGE_PREFIX}/web:1"\n' });
  assert.equal(checkImagePrefixLowercase(bad).length, 1);
  const good = fixture({ '.github/workflows/ci.yml': "jobs:\n  build:\n    steps:\n      - run: |\n          IMAGE_PREFIX=\"$(printf '%s' \"${IMAGE_PREFIX}\" | tr '[:upper:]' '[:lower:]')\"\n          tag=\"${REGISTRY}/${IMAGE_PREFIX}/web:1\"\n" });
  assert.deepEqual(checkImagePrefixLowercase(good), []);
});

test('migration-pairs: a lone up or down is reported', () => {
  const root = fixture({
    'database/migrations/001_a.up.sql': '',
    'database/migrations/001_a.down.sql': '',
    'database/migrations/002_b.up.sql': '',
    'database/migrations/003_c.down.sql': '',
  });
  assert.deepEqual(checkMigrationPairs(root), ['database/migrations/002_b.down.sql is missing', 'database/migrations/003_c.up.sql is missing']);
});

test('no-google-fonts: imports and URLs fail, comments that mention the module do not', () => {
  const root = fixture({
    'web/src/app/layout.tsx': "// next/font/google used to fetch at build\nimport { Syne } from 'next/font/google';\n",
    'web/src/styles/globals.css': '@import url("https://fonts.googleapis.com/css2?family=Syne");\n',
    'web/src/app/ok.tsx': '// self-hosted, never fonts.googleapis.com\n',
  });
  assert.deepEqual(checkNoGoogleFonts(root), ['web/src/app/layout.tsx:2: fetches Google Fonts', 'web/src/styles/globals.css:1: fetches Google Fonts']);
});

test('playwright-fixed-engine: a hard-coded engine launch in test code fails, a comment or a config-chosen engine passes', () => {
  const root = fixture({
    'web/tests/e2e/global-setup.ts': "import { chromium } from '@playwright/test';\n// chromium.launch() used to live here\nconst browser = await chromium.launch();\n",
    'web/tests/e2e/helpers/ok.ts': 'const browser = await ENGINES[name].launch();\n',
    'web/playwright.config.ts': "export default defineConfig({ globalSetup: './tests/e2e/global-setup.ts' });\n",
  });
  const problems = checkPlaywrightFixedEngine(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^web\/tests\/e2e\/global-setup\.ts:3: calls chromium\.launch\(\)/);
});

test('site-url: only site-url.ts and server/env.ts may read NEXT_PUBLIC_SITE_URL', () => {
  const root = fixture({
    'web/src/lib/site-url.ts': "process.env['NEXT_PUBLIC_SITE_URL']\n",
    'web/src/lib/server/env.ts': 'NEXT_PUBLIC_SITE_URL: z.url(),\n',
    'web/src/app/robots.ts': "const base = new URL(process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://x');\n",
  });
  const problems = checkSiteUrl(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^web\/src\/app\/robots\.ts:1:/);
});

test('zod-imports: barrel and classic zod rejected outside server-only code', () => {
  const root = fixture({
    'web/src/components/LoginForm.tsx': "import { loginSchema } from '@/lib/validations';\nimport { z } from 'zod';\n",
    'web/src/components/Ok.tsx': "import { z } from '@/lib/zod-mini';\nimport { loginSchema } from '@/lib/schemas/auth';\n",
    'web/src/app/api/analyze/route.ts': "import { z } from 'zod';\n",
    'web/src/lib/server/env.ts': "import { z } from 'zod';\n",
    'web/src/lib/zod-mini.ts': "export * from 'zod/mini';\n",
  });
  const problems = checkZodImports(root);
  assert.equal(problems.length, 2);
  assert.ok(problems.every((p) => p.startsWith('web/src/components/LoginForm.tsx')));
});

test('xcconfig-wired: an unreferenced xcconfig is reported; Secrets and examples are ignored', () => {
  const pbx = 'path = Debug.xcconfig;\nbaseConfigurationReference = X1 /* Debug.xcconfig */;\n';
  const root = fixture({
    'ios/Config/Debug.xcconfig': '',
    'ios/Config/Release.xcconfig': '',
    'ios/Config/Secrets.xcconfig.example': '',
    'ios/NoMarkup.xcodeproj/project.pbxproj': pbx,
  });
  assert.deepEqual(checkXcconfigWired(root), ['ios/Config/Release.xcconfig is not referenced by ios/NoMarkup.xcodeproj/project.pbxproj; its build settings never apply']);
});

test('secret-shapes: flags added Stripe-shaped literals by location only, never the value', () => {
  const root = mkdtempSync(join(tmpdir(), 'rc-secret-'));
  const g = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.name', 'test']);
  g(['config', 'user.email', 'nobody']);
  writeFileSync(join(root, 'a.ts'), 'const ok = 1;\n');
  g(['add', '.']);
  g(['commit', '-qm', 'init']);
  const value = ['sk', 'test', 'abcdefgh12345678'].join('_');
  writeFileSync(join(root, 'a.ts'), `const ok = 1;\nconst key = "${value}";\nconst built = ['sk', 'test', 'x'].join('_');\nconst hook = "whsec_$(openssl rand -hex 24)";\n`);
  const problems = checkSecretShapes(root, 'main');
  assert.deepEqual(problems, ['a.ts:2: added line contains a literal Stripe secret/restricted/publishable key; build fixtures from parts at runtime']);
  assert.ok(!problems.join('').includes('abcdefgh'));
});

test('every check passes on this repository as committed', () => {
  for (const [name, run] of Object.entries(CHECKS)) {
    if (name === 'secret-shapes') continue; // diff-based; covered above
    assert.deepEqual(run(REPO), [], name);
  }
});
