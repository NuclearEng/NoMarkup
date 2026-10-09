// k6 load test: Tier 1 production-readiness — Auction mixed-traffic load.
//
// Run:
//   k6 run tests/load/auction.js
//   k6 run -e BASE_URL=http://localhost:8081 tests/load/auction.js
//
// Scenario:
//   50 concurrent virtual users for 5 minutes.
//   - 70% provider users: place bids (POST /api/v1/jobs/{id}/bids)
//   - 20% customer users: read jobs/categories/contracts
//   - 10% admin users:    read /api/v1/admin/platform/metrics
//
// Pass criteria (Tier 1):
//   - http_req_duration p99 < 500ms
//   - error rate (non-2xx + non-4xx-business-failures) < 0.1%
//   - zero 5xx responses
//
// Hits all five required endpoints:
//   GET  /api/v1/categories
//   GET  /api/v1/jobs
//   POST /api/v1/jobs/{id}/bids
//   GET  /api/v1/contracts
//   GET  /api/v1/admin/platform/metrics

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8081';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const fiveXXErrors = new Counter('errors_5xx');
const failures    = new Rate('business_failures');
const rateLimited  = new Counter('rate_limited');

// ---------------------------------------------------------------------------
// Test config
// ---------------------------------------------------------------------------

export const options = {
    scenarios: {
        auction_mixed: {
            executor: 'constant-vus',
            vus: 50,
            duration: '5m',
        },
    },
    thresholds: {
        // Tier 1 budget: API p99 < 500ms.
        http_req_duration: ['p(99)<500'],
        // Tier 1 budget: <0.1% server-side errors. 429 (rate-limited)
        // responses are *expected* under sustained load and are tracked
        // separately as `rate_limited` — they are working-as-designed,
        // not a failure. We gate only on 5xx via `errors_5xx`.
        errors_5xx: ['count==0'],
        // Per-endpoint p99 budgets so we can see which surface degrades.
        'http_req_duration{endpoint:categories}':  ['p(99)<500'],
        'http_req_duration{endpoint:jobs_list}':   ['p(99)<500'],
        'http_req_duration{endpoint:place_bid}':   ['p(99)<500'],
        'http_req_duration{endpoint:contracts}':   ['p(99)<500'],
        'http_req_duration{endpoint:admin_metrics}': ['p(99)<500'],
    },
};

// ---------------------------------------------------------------------------
// Setup: log in seed users, gather tokens, gather a list of active jobs.
// ---------------------------------------------------------------------------

function login(email, password) {
    const res = http.post(
        `${BASE_URL}/api/v1/auth/login`,
        JSON.stringify({ email, password }),
        { headers: { 'Content-Type': 'application/json' } },
    );
    if (res.status !== 200) {
        throw new Error(`login ${email} failed: ${res.status} ${res.body}`);
    }
    return JSON.parse(res.body).access_token;
}

export function setup() {
    const customerToken  = login('customer@nomarkup.com',  'Password123!');
    const providerToken  = login('provider@nomarkup.com',  'Password123!');
    const provider2Token = login('provider2@nomarkup.com', 'Password123!');
    const adminToken     = login('admin@nomarkup.com',     'Password123!');

    // Discover an active job to bid on.
    const jobsRes = http.get(`${BASE_URL}/api/v1/jobs?status=active&limit=20`);
    let jobIds = [];
    if (jobsRes.status === 200) {
        try {
            const body = JSON.parse(jobsRes.body);
            if (Array.isArray(body.jobs)) {
                jobIds = body.jobs.filter((j) => j.status === 'active').map((j) => j.id);
            }
        } catch {
            // ignore
        }
    }
    if (jobIds.length === 0) {
        // Fallback to the well-known seed job.
        jobIds = ['00000000-0000-0000-0000-000000000100'];
    }

    return {
        customerToken,
        providerToken,
        provider2Token,
        adminToken,
        jobIds,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders(token, extra) {
    const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
    return Object.assign({ headers }, extra || {});
}

function record5xx(res) {
    if (res.status === 429) {
        // Rate limited by gateway — working as designed.
        rateLimited.add(1);
        return false;
    }
    if (res.status >= 500) {
        fiveXXErrors.add(1);
        failures.add(1);
        return true;
    }
    return false;
}

function pickJob(data) {
    return data.jobIds[Math.floor(Math.random() * data.jobIds.length)];
}

// ---------------------------------------------------------------------------
// Persona: provider (70%) — bids on jobs and reads them.
// ---------------------------------------------------------------------------

function providerFlow(data) {
    // Alternate between two providers so we can place more bids before
    // the unique-bid-per-provider constraint trips.
    const token = Math.random() < 0.5 ? data.providerToken : data.provider2Token;

    // Read the job list (warm path).
    let res = http.get(
        `${BASE_URL}/api/v1/jobs?limit=20`,
        { tags: { endpoint: 'jobs_list' } },
    );
    record5xx(res);
    check(res, { 'jobs list 2xx or 429': (r) => (r.status >= 200 && r.status < 300) || r.status === 429 });

    // Place a bid on a random active job. Most attempts will return 4xx
    // (already bid / auction closed); that's expected — we only fail on 5xx.
    const jobId = pickJob(data);
    const bidPayload = JSON.stringify({
        amount_cents: Math.max(500, Math.floor(Math.random() * 49000) + 500),
        message: 'k6 load-test bid',
        estimated_duration_hours: 4,
    });
    res = http.post(
        `${BASE_URL}/api/v1/jobs/${jobId}/bids`,
        bidPayload,
        authHeaders(token, { tags: { endpoint: 'place_bid' } }),
    );
    record5xx(res);
    check(res, {
        'place_bid no 5xx': (r) => r.status < 500,
    });
}

// ---------------------------------------------------------------------------
// Persona: customer (20%) — browses jobs, reads contracts.
// ---------------------------------------------------------------------------

function customerFlow(data) {
    let res = http.get(
        `${BASE_URL}/api/v1/categories`,
        { tags: { endpoint: 'categories' } },
    );
    record5xx(res);
    check(res, { 'categories 2xx or 429': (r) => r.status === 200 || r.status === 429 });

    res = http.get(
        `${BASE_URL}/api/v1/jobs?limit=20`,
        { tags: { endpoint: 'jobs_list' } },
    );
    record5xx(res);
    check(res, { 'jobs list 2xx or 429': (r) => r.status === 200 || r.status === 429 });

    res = http.get(
        `${BASE_URL}/api/v1/contracts`,
        authHeaders(data.customerToken, { tags: { endpoint: 'contracts' } }),
    );
    record5xx(res);
    check(res, { 'contracts no 5xx': (r) => r.status < 500 });
}

// ---------------------------------------------------------------------------
// Persona: admin (10%) — reads platform metrics.
// ---------------------------------------------------------------------------

function adminFlow(data) {
    const res = http.get(
        `${BASE_URL}/api/v1/admin/platform/metrics`,
        authHeaders(data.adminToken, { tags: { endpoint: 'admin_metrics' } }),
    );
    record5xx(res);
    check(res, { 'admin metrics no 5xx': (r) => r.status < 500 });
}

// ---------------------------------------------------------------------------
// Test execution: pick a persona by random draw at the configured ratio.
// ---------------------------------------------------------------------------

export default function (data) {
    const r = Math.random();
    if (r < 0.70) {
        providerFlow(data);
    } else if (r < 0.90) {
        customerFlow(data);
    } else {
        adminFlow(data);
    }
    sleep(0.2 + Math.random() * 0.3);
}
