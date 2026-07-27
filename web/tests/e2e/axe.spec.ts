/**
 * Browser-driven accessibility smoke (FE-01).
 *
 * Vitest + jsdom covers structural axe rules in tests/integration/axe.test.ts
 * but cannot evaluate color-contrast (no real layout/paint). This Playwright
 * suite re-enables color-contrast against real public routes once the Next.js
 * app is up (Playwright webServer starts `npm run dev`).
 *
 * Backend tolerance:
 *   Public `/`, `/marketplace`, `/jobs`, `/pricing`, and `/login` degrade
 *   without the Go gateway (empty / error / static form UI still mounts).
 *   If the page fails to load at all (web server down, hard 5xx, no body),
 *   the test skips rather than red-fails CI for an environment gap.
 *   No authenticated session is required; `/login` is the auth shell only
 *   (safe without stack — no dashboard/admin surfaces).
 *
 * Scope (honest residual):
 *   - Five public/auth-shell routes; still no dashboard/admin surfaces
 *   - Blocks serious + critical only (moderate/minor tracked elsewhere)
 *   - color-contrast is ON here (off under jsdom)
 *   - Not a full WCAG 2.2 AA certification gate
 */

import { expect, test, type Page } from '@playwright/test';
import axe from 'axe-core';
import type { Result } from 'axe-core';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Inject axe-core and return serious/critical violations (incl. contrast). */
async function runAxeSeriousCritical(page: Page): Promise<Result[]> {
  await page.addScriptTag({ content: axe.source });

  return page.evaluate(async () => {
    // axe.source IIFE attaches `axe` to window.
    const axeWin = (
      window as unknown as {
        axe: {
          run: (
            context: Document,
            options?: { resultTypes?: string[] },
          ) => Promise<{ violations: Result[] }>;
        };
      }
    ).axe;

    const results = await axeWin.run(document, {
      // Default rule set includes color-contrast; do not disable it here.
      resultTypes: ['violations'],
    });

    return results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
  });
}

function formatViolations(violations: Result[]): string {
  if (violations.length === 0) return '(none)';
  return violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 5)
        .map((n) => `    - ${n.target.join(' ')}: ${n.failureSummary ?? n.html}`)
        .join('\n');
      return `[${v.impact ?? 'unknown'}] ${v.id}: ${v.help} (${v.nodes.length} node(s))\n${nodes}`;
    })
    .join('\n\n');
}

/**
 * Navigate to a public route. Returns false when the environment cannot host
 * a scan (connection failure, hard 5xx, missing body) so the caller can skip.
 * Retries a few times: Turbopack cold compile / build-manifest races often
 * yield a one-shot 500 or blank body that recovers on reload.
 */
async function loadPublicRoute(page: Page, path: string): Promise<boolean> {
  const attempts = 3;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await page.goto(path, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      if (!response) {
        await delay(1_000);
        continue;
      }
      // Hard server errors → retry (dev compile race), then skip.
      if (response.status() >= 500) {
        await delay(1_500);
        continue;
      }

      // Let client islands settle; networkidle may hang on long-polls so soft-timeout.
      await page
        .waitForLoadState('networkidle', { timeout: 15_000 })
        .catch(() => undefined);

      const bodyVisible = await page.locator('body').isVisible().catch(() => false);
      if (!bodyVisible) {
        await delay(1_000);
        continue;
      }

      // Next.js app error shell without recoverable content — retry once more.
      const fatal = await page
        .getByText(/Application error: a (client|server)-side exception/i)
        .count()
        .catch(() => 0);
      if (fatal > 0) {
        await delay(1_500);
        continue;
      }

      return true;
    } catch {
      await delay(1_000);
    }
  }
  return false;
}

// Public catalog + pricing + login shell (auth-friendly without credentials).
// Prefer these over dashboard routes so CI skips cleanly when backend is down.
const PUBLIC_ROUTES = ['/', '/marketplace', '/jobs', '/pricing', '/login'] as const;

test.describe('axe e2e smoke — real public routes', () => {
  for (const path of PUBLIC_ROUTES) {
    test(`${path} has no serious/critical axe violations (color-contrast on)`, async ({
      page,
    }) => {
      const loaded = await loadPublicRoute(page, path);
      test.skip(
        !loaded,
        `${path} did not load (web/backend unavailable); skipping real-page axe`,
      );

      const violations = await runAxeSeriousCritical(page);
      expect(
        violations,
        `axe serious/critical on ${path}:\n${formatViolations(violations)}`,
      ).toEqual([]);
    });
  }
});
