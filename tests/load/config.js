// Shared configuration and helpers for k6 load tests.
//
// Usage:
//   import { BASE_URL, authHeaders, randomJobPayload, randomBidPayload, randomString } from './config.js';

// ---------------------------------------------------------------------------
// Base URL — override via environment: k6 run -e BASE_URL=https://staging.nomarkup.com ...
// ---------------------------------------------------------------------------

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Build Authorization headers with a mock JWT.
 * For real load tests against a staging environment, replace with a valid
 * token obtained from your auth flow or set via __ENV.AUTH_TOKEN.
 *
 * @param {string} [role='customer'] - 'customer' | 'provider' | 'admin'
 * @returns {Object} Headers object suitable for http.post/get params.
 */
export function authHeaders(role = 'customer') {
    const token = __ENV.AUTH_TOKEN || `load-test-token-${role}`;
    return {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    };
}

// ---------------------------------------------------------------------------
// Random data generators
// ---------------------------------------------------------------------------

const SERVICE_CATEGORIES = [
    'plumbing',
    'electrical',
    'landscaping',
    'cleaning',
    'painting',
    'hvac',
    'roofing',
    'carpentry',
    'pest_control',
    'moving',
];

const CITIES = [
    { name: 'San Francisco', lat: 37.7749, lng: -122.4194, zip: '94102' },
    { name: 'Los Angeles', lat: 34.0522, lng: -118.2437, zip: '90001' },
    { name: 'New York', lat: 40.7128, lng: -74.006, zip: '10001' },
    { name: 'Chicago', lat: 41.8781, lng: -87.6298, zip: '60601' },
    { name: 'Houston', lat: 29.7604, lng: -95.3698, zip: '77001' },
    { name: 'Phoenix', lat: 33.4484, lng: -112.074, zip: '85001' },
    { name: 'Seattle', lat: 47.6062, lng: -122.3321, zip: '98101' },
    { name: 'Denver', lat: 39.7392, lng: -104.9903, zip: '80201' },
    { name: 'Austin', lat: 30.2672, lng: -97.7431, zip: '73301' },
    { name: 'Portland', lat: 45.5152, lng: -122.6784, zip: '97201' },
];

/**
 * Generate a random string of a given length.
 * @param {number} length
 * @returns {string}
 */
export function randomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Pick a random element from an array.
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
export function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a random integer between min (inclusive) and max (inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Build a realistic job creation payload.
 * @returns {string} JSON string.
 */
export function randomJobPayload() {
    const category = randomChoice(SERVICE_CATEGORIES);
    const city = randomChoice(CITIES);
    const minBudget = randomInt(5000, 50000); // 50.00 - 500.00 in cents
    const maxBudget = minBudget + randomInt(5000, 50000);

    return JSON.stringify({
        title: `${category} job ${randomString(6)}`,
        description: `Need a professional for ${category} work. This is a load test job created at ${new Date().toISOString()}.`,
        category: category,
        budget_min_cents: minBudget,
        budget_max_cents: maxBudget,
        location: {
            lat: city.lat + (Math.random() - 0.5) * 0.1,
            lng: city.lng + (Math.random() - 0.5) * 0.1,
            zip_code: city.zip,
            city: city.name,
        },
        urgency: randomChoice(['low', 'medium', 'high']),
    });
}

/**
 * Build a realistic bid placement payload.
 * @param {number} [maxAmount=50000] Upper bound for bid amount in cents.
 * @returns {string} JSON string.
 */
export function randomBidPayload(maxAmount = 50000) {
    const amount = randomInt(1000, maxAmount);
    return JSON.stringify({
        amount_cents: amount,
        message: `I can do this job for $${(amount / 100).toFixed(2)}. Load test bid.`,
        estimated_duration_hours: randomInt(1, 48),
    });
}

/**
 * Build a search query string with random params.
 * @returns {string} URL query string (without leading ?).
 */
export function randomSearchQuery() {
    const params = [];
    const category = randomChoice(SERVICE_CATEGORIES);
    params.push(`category=${category}`);

    // Sometimes add location-based search.
    if (Math.random() > 0.3) {
        const city = randomChoice(CITIES);
        params.push(`lat=${city.lat}`);
        params.push(`lng=${city.lng}`);
        params.push(`radius_km=${randomInt(5, 50)}`);
    }

    // Sometimes add budget filter.
    if (Math.random() > 0.5) {
        params.push(`budget_min=${randomInt(1000, 10000)}`);
        params.push(`budget_max=${randomInt(10000, 100000)}`);
    }

    // Sometimes add text search.
    if (Math.random() > 0.5) {
        params.push(`q=${randomChoice(['repair', 'install', 'fix', 'replace', 'clean'])}`);
    }

    params.push(`page=1`);
    params.push(`page_size=${randomChoice([10, 20, 50])}`);

    return params.join('&');
}

/**
 * Standard check for successful responses.
 * @param {import('k6/http').RefinedResponse} res
 * @param {number[]} [validStatuses=[200, 201]]
 * @returns {boolean}
 */
export function checkResponse(res, validStatuses = [200, 201]) {
    return validStatuses.includes(res.status);
}
