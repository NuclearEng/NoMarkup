// k6 load test: Live-auction marketplace scoreboard.
//
// Run:
//   k6 run tests/load/marketplace-scoreboard.js
//   k6 run -e BASE_URL=https://staging.nomarkup.com tests/load/marketplace-scoreboard.js
//   k6 run -e VUS=100 tests/load/marketplace-scoreboard.js
//
// Target (per CLAUDE.md §8 + the wedge):
//   - /marketplace page p95 < 200ms, p99 < 500ms
//   - /api/v1/listings (search) p99 < 200ms
//   - /api/v1/listings/{id} (detail) p99 < 200ms
//   - /api/v1/listings/{id}/bids (history) p99 < 200ms
//   - http_req_failed rate < 1%
//
// What this exercises:
//   The scoreboard fan-out under realistic spectator load. A VC walking
//   in with 100 friends should not see the homepage degrade. The
//   scoreboard renders three buckets (closing now / closing soon /
//   later) so this script weighs the closing-soon-filtered query
//   heavier than later buckets — that's where most spectator traffic
//   actually lands.

import http from 'k6/http';
import { check, sleep } from 'k6';
import {
    BASE_URL,
    randomChoice,
    randomInt,
} from './config.js';

// ---------------------------------------------------------------------------
// Test configuration
// ---------------------------------------------------------------------------

const TARGET_VUS = Number(__ENV.VUS) || 100;

export const options = {
    stages: [
        { duration: '15s', target: Math.floor(TARGET_VUS / 4) },
        { duration: '30s', target: Math.floor(TARGET_VUS / 2) },
        { duration: '30s', target: TARGET_VUS },
        { duration: '1m',  target: TARGET_VUS },
        { duration: '15s', target: 0 },
    ],
    thresholds: {
        'http_req_duration{name:scoreboard_html}':   ['p(95)<200', 'p(99)<500'],
        'http_req_duration{name:listings_search}':   ['p(99)<200'],
        'http_req_duration{name:listings_closing}':  ['p(99)<200'],
        'http_req_duration{name:listing_detail}':    ['p(99)<200'],
        'http_req_duration{name:listing_bids}':      ['p(99)<200'],
        http_req_failed: ['rate<0.01'],
    },
};

// ---------------------------------------------------------------------------
// Marketplace categories (must match goods taxonomy in migration 036)
// ---------------------------------------------------------------------------

const GOODS_CATEGORIES = [
    'goods-furniture',
    'goods-electronics',
    'goods-tools',
    'goods-sporting',
    'goods-vehicles',
    'goods-home-garden',
    'goods-books-media',
    'goods-collectibles',
    'goods-clothing',
    'goods-other',
];

const SORT_MODES = ['ending_soon', 'price_asc', 'price_desc', 'newest'];

// Demo seed UUID prefixes — listings the scoreboard will surface when
// SEED_DEMO_MARKETPLACE=1 is loaded. Hitting these directly exercises
// the listing-detail and bid-history endpoints with cache-warm data.
const DEMO_LISTING_IDS = [
    '00000000-0000-0000-0000-000000009000', // Eames lounge — critical
    '00000000-0000-0000-0000-000000009003', // PSA Jordan rookie — critical
    '00000000-0000-0000-0000-000000009100', // Aeron — urgent
    '00000000-0000-0000-0000-000000009104', // MTG Beta starter — urgent
    '00000000-0000-0000-0000-000000009110', // Leica Q3 — urgent
    '00000000-0000-0000-0000-000000009200', // West Elm sofa — normal
    '00000000-0000-0000-0000-000000009208', // Sonos Arc — normal
    '00000000-0000-0000-0000-000000009216', // Omega Seamaster — normal
];

// ---------------------------------------------------------------------------
// Per-VU iteration
//
// Mix matches a realistic spectator session:
//   60% — land on the scoreboard (HTML + listings search)
//   25% — open a listing detail page (detail + bid history fan-out)
//   10% — re-filter the scoreboard (category, sort)
//    5% — closing-soon polled query (every 30s in production)
// ---------------------------------------------------------------------------

export default function () {
    const r = Math.random();

    if (r < 0.6) {
        scoreboardLand();
    } else if (r < 0.85) {
        listingDetailFanout();
    } else if (r < 0.95) {
        scoreboardFilter();
    } else {
        closingSoonPoll();
    }

    // Spectators sit on a page reading; very low think rate.
    sleep(randomInt(1, 4));
}

// ---------------------------------------------------------------------------
// Scenario: VC lands on /marketplace
// ---------------------------------------------------------------------------

function scoreboardLand() {
    // 1. The HTML shell (Next.js page).
    const htmlRes = http.get(
        `${BASE_URL}/marketplace`,
        { tags: { name: 'scoreboard_html' } },
    );
    check(htmlRes, {
        'scoreboard html 200': (r) => r.status === 200,
        'scoreboard html contains "Live Marketplace"': (r) =>
            r.body && r.body.includes('Live Marketplace'),
    });

    // 2. The TanStack Query call the page fires on mount.
    const apiRes = http.get(
        `${BASE_URL}/api/v1/listings?page=1&page_size=60`,
        { tags: { name: 'listings_search' } },
    );
    check(apiRes, {
        'listings search 200': (r) => r.status === 200,
        'listings search returns array': (r) => {
            try {
                const body = JSON.parse(r.body);
                return Array.isArray(body.listings);
            } catch {
                return false;
            }
        },
    });
}

// ---------------------------------------------------------------------------
// Scenario: VC clicks a closing-soon card
// ---------------------------------------------------------------------------

function listingDetailFanout() {
    const id = randomChoice(DEMO_LISTING_IDS);

    const detailRes = http.get(
        `${BASE_URL}/api/v1/listings/${id}`,
        { tags: { name: 'listing_detail' } },
    );
    check(detailRes, {
        'listing detail 200 or 404': (r) => r.status === 200 || r.status === 404,
    });

    // Bid history is fetched in parallel by the detail page hook.
    const bidsRes = http.get(
        `${BASE_URL}/api/v1/listings/${id}/bids`,
        { tags: { name: 'listing_bids' } },
    );
    check(bidsRes, {
        'listing bids 200 or 404': (r) => r.status === 200 || r.status === 404,
    });
}

// ---------------------------------------------------------------------------
// Scenario: spectator filters the scoreboard
// ---------------------------------------------------------------------------

function scoreboardFilter() {
    const category = randomChoice(GOODS_CATEGORIES);
    const sort = randomChoice(SORT_MODES);
    const url = `${BASE_URL}/api/v1/listings?category=${category}&sort_by=${sort}&page=1&page_size=20`;

    const res = http.get(url, { tags: { name: 'listings_search' } });
    check(res, {
        'filter search 200': (r) => r.status === 200,
    });
}

// ---------------------------------------------------------------------------
// Scenario: client polls "closing in <1h" every 30s for the urgency strip
// ---------------------------------------------------------------------------

function closingSoonPoll() {
    const res = http.get(
        `${BASE_URL}/api/v1/listings?ending_soon=true&page=1&page_size=20`,
        { tags: { name: 'listings_closing' } },
    );
    check(res, {
        'closing-soon 200': (r) => r.status === 200,
    });
}
