// k6 load test: Search endpoint.
//
// Run:
//   k6 run tests/load/search.js
//   k6 run -e BASE_URL=https://staging.nomarkup.com tests/load/search.js
//
// Target (from CLAUDE.md):
//   - Search query p99 < 50ms (sub-50ms Meilisearch target)

import http from 'k6/http';
import { check, sleep } from 'k6';
import {
    BASE_URL,
    authHeaders,
    randomSearchQuery,
    randomChoice,
    randomString,
} from './config.js';

// ---------------------------------------------------------------------------
// Test configuration
// ---------------------------------------------------------------------------

export const options = {
    stages: [
        { duration: '20s', target: 50 },  // Ramp up to 50 VUs.
        { duration: '30s', target: 150 }, // Ramp up to 150 VUs.
        { duration: '1m', target: 150 },  // Hold at 150 VUs for 1 minute.
        { duration: '20s', target: 0 },   // Ramp down.
    ],
    thresholds: {
        // Sub-50ms target for search queries at p99.
        'http_req_duration{name:search_jobs}': ['p(99)<50'],
        // Text search can be slightly slower.
        'http_req_duration{name:text_search}': ['p(99)<50'],
        // Category browse.
        'http_req_duration{name:category_browse}': ['p(99)<50'],
        // Geo search.
        'http_req_duration{name:geo_search}': ['p(99)<50'],
        // At least 95% of requests must succeed.
        http_req_failed: ['rate<0.05'],
    },
};

// ---------------------------------------------------------------------------
// Search scenarios
// ---------------------------------------------------------------------------

const CATEGORIES = [
    'plumbing', 'electrical', 'landscaping', 'cleaning',
    'painting', 'hvac', 'roofing', 'carpentry',
];

const SEARCH_TERMS = [
    'repair', 'install', 'fix', 'replace', 'clean',
    'maintenance', 'inspection', 'emergency', 'remodel',
    'upgrade', 'removal', 'setup',
];

const LOCATIONS = [
    { lat: 37.7749, lng: -122.4194 },  // San Francisco
    { lat: 34.0522, lng: -118.2437 },  // Los Angeles
    { lat: 40.7128, lng: -74.006 },    // New York
    { lat: 41.8781, lng: -87.6298 },   // Chicago
    { lat: 47.6062, lng: -122.3321 },  // Seattle
];

// ---------------------------------------------------------------------------
// Test execution
// ---------------------------------------------------------------------------

export default function () {
    const scenario = Math.random();

    if (scenario < 0.3) {
        // --- Full-text search ---
        const term = randomChoice(SEARCH_TERMS);
        const res = http.get(
            `${BASE_URL}/api/v1/jobs?q=${term}&page=1&page_size=20`,
            Object.assign({ tags: { name: 'text_search' } }, authHeaders()),
        );

        check(res, {
            'text search returns 200': (r) => r.status === 200,
            'text search has results': (r) => {
                try {
                    const body = JSON.parse(r.body);
                    return body.jobs !== undefined || body.data !== undefined;
                } catch {
                    return false;
                }
            },
        });
    } else if (scenario < 0.6) {
        // --- Category browse ---
        const category = randomChoice(CATEGORIES);
        const res = http.get(
            `${BASE_URL}/api/v1/jobs?category=${category}&page=1&page_size=20&sort=created_at:desc`,
            Object.assign({ tags: { name: 'category_browse' } }, authHeaders()),
        );

        check(res, {
            'category browse returns 200': (r) => r.status === 200,
        });
    } else if (scenario < 0.85) {
        // --- Geo-filtered search ---
        const loc = randomChoice(LOCATIONS);
        const radius = randomChoice([5, 10, 25, 50]);
        const res = http.get(
            `${BASE_URL}/api/v1/jobs?lat=${loc.lat}&lng=${loc.lng}&radius_km=${radius}&page=1&page_size=20`,
            Object.assign({ tags: { name: 'geo_search' } }, authHeaders()),
        );

        check(res, {
            'geo search returns 200': (r) => r.status === 200,
        });
    } else {
        // --- Combined search (text + category + location) ---
        const queryString = randomSearchQuery();
        const res = http.get(
            `${BASE_URL}/api/v1/jobs?${queryString}`,
            Object.assign({ tags: { name: 'search_jobs' } }, authHeaders()),
        );

        check(res, {
            'combined search returns 200': (r) => r.status === 200,
        });
    }

    // Keep think time minimal to maximize search throughput.
    sleep(0.1);
}
