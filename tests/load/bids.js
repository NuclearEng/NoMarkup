// k6 load test: Bid placement under high concurrency.
//
// Run:
//   k6 run tests/load/bids.js
//   k6 run -e BASE_URL=https://staging.nomarkup.com -e JOB_ID=<uuid> tests/load/bids.js
//
// Target:
//   - POST /api/v1/jobs/{jobID}/bids: p99 < 500ms
//   - Bid processing target from CLAUDE.md: < 1ms p99 (engine-level)

import http from 'k6/http';
import { check, sleep } from 'k6';
import {
    BASE_URL,
    authHeaders,
    randomBidPayload,
    randomString,
    randomInt,
} from './config.js';

// ---------------------------------------------------------------------------
// Test configuration
// ---------------------------------------------------------------------------

export const options = {
    stages: [
        { duration: '30s', target: 200 }, // Ramp up to 200 VUs over 30s.
        { duration: '2m', target: 200 },  // Hold at 200 VUs for 2 minutes.
        { duration: '30s', target: 0 },   // Ramp down to 0 over 30s.
    ],
    thresholds: {
        // Overall p99 response time must be under 500ms.
        http_req_duration: ['p(99)<500'],
        // At least 95% of requests must succeed.
        http_req_failed: ['rate<0.05'],
        // Per-endpoint thresholds.
        'http_req_duration{name:place_bid}': ['p(99)<500'],
        'http_req_duration{name:get_bids}': ['p(95)<200'],
    },
};

// ---------------------------------------------------------------------------
// Setup: create a test job to bid on, or use a provided JOB_ID.
// ---------------------------------------------------------------------------

export function setup() {
    // Use an environment-provided job ID, or create one.
    if (__ENV.JOB_ID) {
        return { jobIds: [__ENV.JOB_ID] };
    }

    // Create multiple jobs so bid attempts are spread across them.
    const jobIds = [];
    for (let i = 0; i < 10; i++) {
        const payload = JSON.stringify({
            title: `Load test bid target ${i} ${randomString(6)}`,
            description: 'Job created for bid load testing.',
            category: 'plumbing',
            budget_min_cents: 5000,
            budget_max_cents: 50000,
            location: {
                lat: 37.7749 + Math.random() * 0.1,
                lng: -122.4194 + Math.random() * 0.1,
                zip_code: '94102',
                city: 'San Francisco',
            },
            urgency: 'medium',
        });

        const res = http.post(
            `${BASE_URL}/api/v1/jobs`,
            payload,
            authHeaders('customer'),
        );

        if (res.status === 201) {
            try {
                const body = JSON.parse(res.body);
                if (body.id) {
                    jobIds.push(body.id);
                }
            } catch {
                // Ignore parse errors during setup.
            }
        }
    }

    // If job creation failed (e.g. server not running), use placeholder IDs.
    // The bids will fail with 404, but we still measure latency.
    if (jobIds.length === 0) {
        for (let i = 0; i < 10; i++) {
            jobIds.push(`00000000-0000-0000-0000-00000000000${i}`);
        }
    }

    return { jobIds };
}

// ---------------------------------------------------------------------------
// Test execution
// ---------------------------------------------------------------------------

export default function (data) {
    const jobId = data.jobIds[randomInt(0, data.jobIds.length - 1)];

    // --- POST: Place a bid ---
    const bidRes = http.post(
        `${BASE_URL}/api/v1/jobs/${jobId}/bids`,
        randomBidPayload(),
        Object.assign({ tags: { name: 'place_bid' } }, authHeaders('provider')),
    );

    check(bidRes, {
        'place bid status is 200 or 201': (r) => r.status === 200 || r.status === 201,
        'place bid has id': (r) => {
            try {
                const body = JSON.parse(r.body);
                return body.id !== undefined;
            } catch {
                return false;
            }
        },
    });

    sleep(0.3);

    // --- GET: List bids for the job ---
    const listRes = http.get(
        `${BASE_URL}/api/v1/jobs/${jobId}/bids`,
        Object.assign({ tags: { name: 'get_bids' } }, authHeaders('customer')),
    );

    check(listRes, {
        'list bids status is 200': (r) => r.status === 200,
    });

    sleep(0.2);
}
