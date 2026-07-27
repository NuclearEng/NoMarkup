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
// Optional: AUTH_TOKEN for future authed smokes (unused on public paths below).
//
// Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from './config.js';

// ---------------------------------------------------------------------------
// Smoke configuration — few iterations, not a ramp.
// ---------------------------------------------------------------------------

export const options = {
    vus: 1,
    iterations: 5,
    // Availability-oriented; do not claim CLAUDE.md §8 p99 budgets from this script.
    thresholds: {
        checks: ['rate>0.8'],
        http_req_failed: ['rate<0.2'],
        http_req_duration: ['p(95)<5000'],
    },
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

export default function () {
    for (const { path, name, ok } of PUBLIC_PATHS) {
        const res = http.get(`${BASE_URL}${path}`, {
            tags: { name },
            timeout: '15s',
        });
        check(res, {
            [`${name} status ok`]: (r) => ok.includes(r.status),
        });
        sleep(0.1);
    }
}
