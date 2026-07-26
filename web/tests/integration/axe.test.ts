/**
 * axe.test.ts — accessibility CI gate.
 *
 * NOTE on test runner:
 *   This file lives under tests/integration so it runs with the rest of
 *   the Vitest suite. It uses Vitest + jsdom + axe-core rather than
 *   Playwright/Chromium because:
 *     - the integration tests already run fully isolated under jsdom
 *     - axe-core ships a pure-JS implementation that runs against any DOM
 *     - Playwright requires a running web server; that adds CI flake.
 *
 *   For a browser-driven version (requires `npm run dev` to be live),
 *   see the (TODO) e2e/axe.spec.ts companion — one real-page smoke is
 *   sketched there when Playwright + a backend/stack are available.
 *
 * Scope (FE-01):
 *   We mount real lightweight React components (EmptyState, Logo, StarRating,
 *   Button) plus minimal HTML stubs for route shells and assert ZERO
 *   `serious` or `critical` violations from axe-core's default rule set.
 *
 *   Color-contrast: re-enabled when axe can evaluate it. In jsdom, computed
 *   styles are incomplete so color-contrast often false-positives; we keep
 *   it disabled under jsdom and document that Playwright e2e axe should
 *   re-enable it (see tests/e2e/axe.spec.ts TODO).
 *
 * Why this file is the CI gate:
 *   The existing test suite already runs via `bun run test`; adding axe
 *   here means every commit gets accessibility coverage with no new
 *   infrastructure. When a violation lands, the test fails the build.
 */

import { createElement, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) =>
    createElement('a', { href, ...rest }, children),
}));

// The payment confirmation form is the only new surface here that pulls in
// Stripe. Stripe Elements renders inside a cross-origin iframe that jsdom
// cannot host and axe cannot inspect, so we stub the SDK: what we assert is
// OUR markup around it — the labelled field group, the live region, the
// submit control — which is where the a11y defects would be. The iframe's own
// accessibility is Stripe's responsibility and is not covered here.
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
  PaymentElement: () =>
    createElement('input', {
      type: 'text',
      'aria-label': 'Card number (Stripe iframe stand-in)',
    }),
  useStripe: () => ({ confirmPayment: () => Promise.resolve({}) }),
  useElements: () => ({ submit: () => Promise.resolve({}) }),
}));

vi.mock('@/lib/stripe', () => ({
  getStripe: () => Promise.resolve(null),
  isStripeConfigured: () => true,
}));

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Logo } from '@/components/layout/Logo';
import { StarRatingDisplay } from '@/components/reviews/StarRating';
import StripePaymentForm from '@/components/payments/StripePaymentForm';

// runAxe filters axe-core's findings down to the impacts we treat as
// blocking. `moderate` and `minor` violations are tracked separately so
// the CI gate doesn't flag stylistic edge cases.
async function runAxe(node: HTMLElement) {
  const result = await axe.run(node, {
    rules: {
      // jsdom does not compute layout/colors reliably — leave disabled here.
      // TODO(e2e): enable color-contrast in Playwright axe on a real page
      // (tests/e2e/axe.spec.ts) once the stack is up.
      'color-contrast': { enabled: false },
    },
  });
  return result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
}

function mount(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

function unmount(container: HTMLElement) {
  if (container.parentNode) container.parentNode.removeChild(container);
}

describe('axe accessibility gate — HTML stubs', () => {
  it('home landing renders zero serious or critical violations', async () => {
    const container = mount(`
      <main>
        <h1>NoMarkup — local marketplace</h1>
        <nav aria-label="Primary">
          <ul>
            <li><a href="/marketplace">Browse marketplace</a></li>
            <li><a href="/jobs">Find a pro</a></li>
            <li><a href="/login">Sign in</a></li>
          </ul>
        </nav>
        <p>Buy, sell, and hire neighbors. No markup.</p>
      </main>
    `);
    try {
      const violations = await runAxe(container);
      expect(violations).toEqual([]);
    } finally {
      unmount(container);
    }
  });

  it('marketplace landing renders zero serious or critical violations', async () => {
    const container = mount(`
      <main>
        <h1>Marketplace</h1>
        <form role="search" aria-label="Search listings">
          <label for="q">Search</label>
          <input id="q" type="search" name="q" />
          <button type="submit">Search</button>
        </form>
        <section aria-labelledby="trending-heading">
          <h2 id="trending-heading">Trending now</h2>
          <ul>
            <li><a href="/marketplace/abc">Item</a></li>
          </ul>
        </section>
      </main>
    `);
    try {
      const violations = await runAxe(container);
      expect(violations).toEqual([]);
    } finally {
      unmount(container);
    }
  });

  it('jobs landing renders zero serious or critical violations', async () => {
    const container = mount(`
      <main>
        <h1>Jobs near you</h1>
        <ul aria-label="Open jobs">
          <li><a href="/jobs/1">Roofing — Boulder, CO</a></li>
          <li><a href="/jobs/2">Plumbing — Denver, CO</a></li>
        </ul>
      </main>
    `);
    try {
      const violations = await runAxe(container);
      expect(violations).toEqual([]);
    } finally {
      unmount(container);
    }
  });

  it('login screen renders zero serious or critical violations', async () => {
    const container = mount(`
      <main>
        <h1>Sign in</h1>
        <form>
          <label for="email">Email</label>
          <input id="email" type="email" name="email" autocomplete="email" required />
          <label for="password">Password</label>
          <input id="password" type="password" name="password" autocomplete="current-password" required />
          <button type="submit">Sign in</button>
        </form>
      </main>
    `);
    try {
      const violations = await runAxe(container);
      expect(violations).toEqual([]);
    } finally {
      unmount(container);
    }
  });
});

describe('axe accessibility gate — real lightweight components (FE-01)', () => {
  it('EmptyState has zero serious/critical violations', async () => {
    const { container } = render(
      createElement(EmptyState, {
        title: 'No results',
        description: 'Try adjusting your filters.',
        action: createElement(Button, { type: 'button' }, 'Clear filters'),
      }),
    );
    const violations = await runAxe(container);
    expect(violations).toEqual([]);
  });

  it('Logo has zero serious/critical violations', async () => {
    const { container } = render(createElement(Logo));
    const violations = await runAxe(container);
    expect(violations).toEqual([]);
  });

  it('StarRatingDisplay has zero serious/critical violations', async () => {
    const { container } = render(
      createElement(StarRatingDisplay, { rating: 4.5 }),
    );
    const violations = await runAxe(container);
    expect(violations).toEqual([]);
  });

  it('Button primary has zero serious/critical violations', async () => {
    const { container } = render(
      createElement(Button, { type: 'button' }, 'Place bid'),
    );
    const violations = await runAxe(container);
    expect(violations).toEqual([]);
  });

  it('payment confirmation form has zero serious/critical violations', async () => {
    const { container } = render(
      createElement(StripePaymentForm, {
        clientSecret: ['pi', '3Test', 'secret', 'abc'].join('_'),
        returnPath: '/orders/order-1',
        submitLabel: 'Pay $42.00',
        onOutcome: () => undefined,
        onCancel: () => undefined,
      }),
    );
    const violations = await runAxe(container);
    expect(violations).toEqual([]);

    // A payment form a screen reader user cannot complete is not done, so
    // assert the semantics explicitly rather than trusting a clean axe run:
    // a named field group, a polite live region for the async result, and a
    // real submit control.
    expect(container.querySelector('[role="group"]')).not.toBeNull();
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.getAttribute('role')).toBe('status');
    expect(container.querySelector('button[type="submit"]')).not.toBeNull();
  });
});
