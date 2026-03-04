// k6 load test: Job posting and listing.
//
// Run:
//   k6 run tests/load/jobs.js
//   k6 run -e BASE_URL=https://staging.nomarkup.com tests/load/jobs.js
//
// Target:
//   - POST /api/v1/jobs: p95 < 200ms
//   - GET  /api/v1/jobs: p95 < 200ms

import http from 'k6/http';
import { check, sleep } from 'k6';
import {
    BASE_URL,
    authHeaders,
    randomJobPayload,
    randomSearchQuery,
} from './config.js';

// ---------------------------------------------------------------------------
// Test configuration
// ---------------------------------------------------------------------------

export const options = {
    stages: [
        { duration: '30s', target: 100 }, // Ramp up to 100 VUs over 30s.
        { duration: '1m', target: 100 },  // Hold at 100 VUs for 1 minute.
        { duration: '30s', target: 0 },   // Ramp down to 0 over 30s.
    ],
    thresholds: {
        // Overall p95 response time must be under 200ms.
        http_req_duration: ['p(95)<200'],
        // At least 95% of requests must succeed.
        http_req_failed: ['rate<0.05'],
        // Per-endpoint thresholds.
        'http_req_duration{name:create_job}': ['p(95)<200'],
        'http_req_duration{name:search_jobs}': ['p(95)<200'],
    },
};

// ---------------------------------------------------------------------------
// Test execution
// ---------------------------------------------------------------------------

export default function () {
    // --- POST: Create a new job ---
    const createRes = http.post(
        `${BASE_URL}/api/v1/jobs`,
        randomJobPayload(),
        Object.assign({ tags: { name: 'create_job' } }, authHeaders('customer')),
    );

    check(createRes, {
        'create job status is 201': (r) => r.status === 201,
        'create job has id': (r) => {
            try {
                const body = JSON.parse(r.body);
                return body.id !== undefined;
            } catch {
                return false;
            }
        },
    });

    sleep(0.5);

    // --- GET: Search / list jobs ---
    const searchRes = http.get(
        `${BASE_URL}/api/v1/jobs?${randomSearchQuery()}`,
        Object.assign({ tags: { name: 'search_jobs' } }, authHeaders('customer')),
    );

    check(searchRes, {
        'search jobs status is 200': (r) => r.status === 200,
        'search jobs returns array': (r) => {
            try {
                const body = JSON.parse(r.body);
                return Array.isArray(body.jobs) || Array.isArray(body.data);
            } catch {
                return false;
            }
        },
    });

    sleep(0.5);
}
