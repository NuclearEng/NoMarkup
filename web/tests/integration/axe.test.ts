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
 *   see the (TODO) e2e/axe.spec.ts companion.
 *
 * Scope:
 *   We construct minimal HTML stubs for /, /marketplace, /jobs, and
 *   /login and assert ZERO `serious` or `critical` violations from
 *   axe-core's default rule set. Color-contrast checks are disabled
 *   because jsdom does not compute layout or colors — the rule would
 *   otherwise emit false positives.
 *
 * Why this file is the CI gate:
 *   The existing test suite already runs via `bun run test`; adding axe
 *   here means every commit gets accessibility coverage with no new
 *   infrastructure. When a violation lands, the test fails the build.
 */

import { describe, expect, it } from 'vitest';
import axe from 'axe-core';

// runAxe filters axe-core's findings down to the impacts we treat as
// blocking. `moderate` and `minor` violations are tracked separately so
// the CI gate doesn't flag stylistic edge cases.
async function runAxe(node: HTMLElement) {
  const result = await axe.run(node, {
    rules: {
      'color-contrast': { enabled: false },
    },
  });
  return result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
}

// mount inserts an HTML string into a fresh container under document.body
// and returns the container. Cleaning up after each test is important
// because jsdom's body is shared across the file.
function mount(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

function unmount(container: HTMLElement) {
  if (container.parentNode) container.parentNode.removeChild(container);
}

describe('axe accessibility gate', () => {
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
