/**
 * PERF-02 — Lighthouse CI budgets for key public routes.
 *
 * Prefer the wrapper (sets env, isolated dist, standalone server, port):
 *   cd web && npm run lighthouse:ci
 *
 * Routes: `/`, `/marketplace`, `/jobs`.
 *
 * Threshold philosophy (honest — do not greenwash):
 *   - **CI regression floors** below are deliberately loose. Lab LCP on these
 *     routes is multi-second in measured baselines (docs/performance.md). The
 *     gate exists so we notice catastrophic regressions, not North Star wins.
 *   - **Stretch / North Star** (CLAUDE.md §14 / docs/performance.md) are
 *     documented here but NOT asserted until lab is under the bar:
 *       Performance score ≥ 0.90
 *       LCP P75 field < 1.5s (lab stretch < 2.5s)
 *       CLS < 0.05
 *       INP < 100ms (field; not a lab-only audit)
 *
 * `scripts/run-lighthouse-ci.mjs` rewrites startServerCommand + URLs into
 * `lighthouserc.runtime.cjs` (gitignored) for the active LHCI_PORT.
 *
 * CI job: `.github/workflows/ci.yml` → `lighthouse-budget` (optional /
 * continue-on-error on PR; hard fail on schedule when floors break).
 */

/** @type {import('@lhci/cli').Config} */
module.exports = {
  ci: {
    collect: {
      // Overridden at runtime by run-lighthouse-ci.mjs (standalone server + port).
      startServerCommand: 'node .next-lhci/standalone/server.js',
      startServerReadyPattern: 'Ready',
      startServerReadyTimeout: 120_000,
      url: [
        'http://127.0.0.1:3011/',
        'http://127.0.0.1:3011/marketplace',
        'http://127.0.0.1:3011/jobs',
      ],
      numberOfRuns: Number(process.env.LHCI_NUMBER_OF_RUNS || 1),
      settings: {
        // Desktop preset keeps CI less CPU-throttled than mobile emulation;
        // still not a field gate. Stretch scores remain documented above.
        preset: 'desktop',
        chromeFlags: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--headless=new',
        ].join(' '),
        onlyCategories: [
          'performance',
          'accessibility',
          'best-practices',
          'seo',
        ],
      },
    },
    assert: {
      assertMatrix: [
        {
          matchingUrlPattern: '.*',
          assertions: {
            // ── CI regression floors (enforce) ──────────────────────────
            'categories:performance': [
              'error',
              { minScore: 0.3, aggregationMethod: 'median' },
            ],
            'categories:accessibility': [
              'error',
              { minScore: 0.7, aggregationMethod: 'median' },
            ],
            'categories:best-practices': [
              'warn',
              { minScore: 0.7, aggregationMethod: 'median' },
            ],
            'categories:seo': [
              'warn',
              { minScore: 0.7, aggregationMethod: 'median' },
            ],
            'largest-contentful-paint': [
              'error',
              { maxNumericValue: 12_000, aggregationMethod: 'median' },
            ],
            // Lab CLS on `/` measured ~0.38 on first smoke (2026-07-27) with
            // empty API seed — floor 0.50 catches catastrophic layout breakage
            // only. North Star is 0.05 (not asserted here).
            'cumulative-layout-shift': [
              'error',
              { maxNumericValue: 0.5, aggregationMethod: 'median' },
            ],
            'total-blocking-time': [
              'warn',
              { maxNumericValue: 3_000, aggregationMethod: 'median' },
            ],
            interactive: [
              'warn',
              { maxNumericValue: 15_000, aggregationMethod: 'median' },
            ],
          },
        },
      ],
    },
    upload: {
      target: 'filesystem',
      outputDir: './lighthouse-reports',
    },
  },
};
