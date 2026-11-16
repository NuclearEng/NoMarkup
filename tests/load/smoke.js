// k6 smoke — public catalog / health only (PERF-10 Partial).
//
// Purpose: prove the optional CI path works and that a configured BASE_URL
// answers. This is NOT a capacity / p99 load proof. Full profiles live in
// jobs.js, bids.js, search.js, auction.js, websocket.js, marketplace-scoreboard.js.
//
// Local (gateway default):
//   k6 run tests/load/smoke.js
//   k6 run -e BASE_URL=http://127.0.0.1:8080 tests/load/smoke.js
//
// Staging / edge (set repo variable K6_BASE_URL for CI):
//   k6 run -e BASE_URL=https://api.example.com tests/load/smoke.js
//
// CI job: `.github/workflows/ci.yml` → `k6-smoke` (schedule + workflow_dispatch).
// Uploads `artifacts/k6/` (summary JSON + console log). Skips when K6_BASE_URL unset.
//
// Optional: AUTH_TOKEN for future authed smokes (unused on public paths below).
//
// Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL as RAW_BASE_URL } from './config.js';

// Strip trailing slashes so path joins never produce //healthz.
const BASE_URL = String(RAW_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// Smoke configuration — few iterations, not a ramp.
// ---------------------------------------------------------------------------

export const options = {
    vus: 1,
    iterations: 5,
    // Fail the run if thresholds break (CI surfaces orange job + artifact).
    // Availability-oriented only — do NOT claim CLAUDE.md §8 p99 budgets.
    thresholds: {
        checks: ['rate>0.8'],
        http_req_failed: ['rate<0.2'],
        http_req_duration: ['p(95)<5000'],
    },
    // Keep summary stable for --summary-export in CI.
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)'],
};

/** Public GET paths that need no JWT (gateway surface). */
const PUBLIC_PATHS = [
    { path: '/healthz', name: 'healthz', ok: [200] },
    { path: '/health', name: 'health', ok: [200] },
    { path: '/api/v1/pricing', name: 'pricing', ok: [200] },
    { path: '/api/v1/markets', name: 'markets', ok: [200] },
    { path: '/api/v1/categories', name: 'categories', ok: [200] },
    { path: '/api/v1/jobs?page=1&page_size=10', name: 'jobs_search', ok: [200] },
    { path: '/api/v1/listings?page=1&page_size=10', name: 'listings', ok: [200] },
];

export function setup() {
    // One cheap probe so the summary always records target reachability.
    const res = http.get(`${BASE_URL}/healthz`, {
        timeout: '10s',
        tags: { name: 'setup_healthz' },
    });
    return {
        baseUrl: BASE_URL,
        setupStatus: res.status,
    };
}

export default function () {
    for (const { path, name, ok } of PUBLIC_PATHS) {
        const res = http.get(`${BASE_URL}${path}`, {
            tags: { name },
            timeout: '15s',
            headers: { Accept: 'application/json' },
        });
        check(res, {
            [`${name} status ok`]: (r) => ok.includes(r.status),
        });
        sleep(0.1);
    }
}
