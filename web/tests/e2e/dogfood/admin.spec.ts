import { test } from '@playwright/test';

import {
  expect,
  expectNotErrorPage,
  expectPageLoaded,
  loginAs,
  navigateTo,
} from './fixtures';

/* ------------------------------------------------------------------ */
/*  Admin E2E Dogfooding Tests                                         */
/*  Persona: admin@nomarkup.com (role: admin)                         */
/*  Credentials sourced from SEED_PASSWORD env var via fixtures.ts     */
/* ------------------------------------------------------------------ */

/** Verify a DataTable rendered: either rows exist OR empty state shows. */
async function expectTableOrEmpty(page: import('@playwright/test').Page) {
  const table = page.locator('table');
  if ((await table.count()) > 0) {
    const rows = table.first().locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  } else {
    const emptyState = page.getByText(
      /no .* found|no results|no .* available|no .* pending|no .* matching|no .* yet|queue is empty/i,
    );
    await expect(emptyState.first()).toBeVisible({ timeout: 15_000 });
  }
}

test.describe('Admin: Dashboard', () => {
  test('shows Admin Overview with metric cards', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin', 'admin');

    await expectPageLoaded(page, /Admin Overview/i);
    await expectNotErrorPage(page);

    // Primary metric cards
    const primaryMetrics = [
      'Total Users',
      'Active Jobs',
      'GMV',
      'Platform Revenue',
      'Open Disputes',
      'Guarantee Fund',
    ];
    for (const metric of primaryMetrics) {
      await expect(page.getByText(metric, { exact: true }).first()).toBeVisible({
        timeout: 10_000,
      });
    }

    // Secondary metric cards
    const secondaryMetrics = [
      'Total Bids',
      'Avg Bids per Job',
      'Job Completion Rate',
      'Guarantee Payouts',
    ];
    for (const metric of secondaryMetrics) {
      await expect(page.getByText(metric, { exact: true }).first()).toBeVisible();
    }
  });
});

test.describe('Admin: User Management', () => {
  test('renders page with heading, search, filters, and data table', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/users', 'admin');

    await expectPageLoaded(page, /User Management/i);
    await expectNotErrorPage(page);

    // Search input
    const searchInput = page.getByPlaceholder(/Search by name or email/i);
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Status + role filters (visible, not count >= 1)
    await expect(page.getByLabel(/Filter by status/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel(/Filter by role/i).first()).toBeVisible({ timeout: 10_000 });

    // Data table should have rows or show empty state
    await expectTableOrEmpty(page);
  });

  test('search submission updates results', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/users', 'admin');
    await expectPageLoaded(page, /User Management/i);

    const searchInput = page.getByPlaceholder(/Search by name or email/i);
    await searchInput.fill('customer');
    await searchInput.press('Enter');
    await page.waitForTimeout(1_000);

    await expectNotErrorPage(page);
    await expectTableOrEmpty(page);
  });

  test('Suspend and Ban buttons are present on user rows', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/users', 'admin');
    await expectPageLoaded(page, /User Management/i);
    await page.waitForTimeout(2_000);

    // Seeded stack must render the users table (or a real empty state) — never
    // `expect(true)` as a vacuous pass (QA-07).
    await expectTableOrEmpty(page);

    const table = page.locator('table');
    if ((await table.count()) === 0) {
      return; // empty-state path already asserted above
    }
    const rows = table.first().locator('tbody tr');
    const rowCount = await rows.count();
    if (rowCount === 0) {
      return;
    }
    // Seed users exist → moderation actions must be on the row.
    await expect(
      page
        .getByRole('button', { name: /Suspend/i })
        .or(page.getByRole('button', { name: /Ban/i }))
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Admin: User Detail', () => {
  test('loads user detail page for seed customer user', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/users/00000000-0000-0000-0000-000000000002', 'admin');

    await expectNotErrorPage(page);
    // Seed customer: display name or email as h1, plus profile chrome / actions
    await expect(
      page
        .getByRole('heading', { name: /Jane Customer|customer@nomarkup\.com|User Detail/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page
        .getByText(/customer@nomarkup\.com/i)
        .or(page.getByText(/User Profile/i))
        .or(page.getByRole('button', { name: /Suspend|Ban/i }))
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Admin: Job Management', () => {
  test('renders page with heading and data', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/jobs', 'admin');

    await expectPageLoaded(page, /Job Management/i);
    await expectNotErrorPage(page);
    await page.waitForTimeout(2_000);

    await expectTableOrEmpty(page);
  });
});

test.describe('Admin: Dispute Management', () => {
  test('renders page with heading and status filter', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/disputes', 'admin');

    await expectPageLoaded(page, /Dispute Management/i);
    await expectNotErrorPage(page);

    // Status filter dropdown should exist
    await expect(page.getByRole('combobox').or(page.locator('select')).first()).toBeVisible({
      timeout: 10_000,
    });

    await expectTableOrEmpty(page);
  });
});

test.describe('Admin: Payment Administration', () => {
  test('renders page with revenue cards and fee form', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/payments', 'admin');

    await expectPageLoaded(page, /Payment Administration/i);
    await expectNotErrorPage(page);
    await page.waitForTimeout(2_000);

    // Revenue summary cards — require at least two known labels
    const revenueTerms = ['GMV', 'Revenue', 'Guarantee', 'Take Rate'] as const;
    const visible = await Promise.all(
      revenueTerms.map(async (term) =>
        page.getByText(term, { exact: false }).first().isVisible().catch(() => false),
      ),
    );
    const foundCount = visible.filter(Boolean).length;
    expect(foundCount, 'payment admin must show revenue summary labels').toBeGreaterThanOrEqual(2);

    // Fee configuration form (numeric inputs must be visible)
    await expect(page.locator('input[type="number"]').first()).toBeVisible({ timeout: 15_000 });
  });

  test('fee percentage input accepts numeric values', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/payments', 'admin');
    await expectPageLoaded(page, /Payment Administration/i);
    await page.waitForTimeout(2_000);

    // Fee form is required on this page.
    // Do not vacuous-pass when missing (QA-07).
    const feeInputs = page.locator('input[type="number"]');
    await expect(feeInputs.first()).toBeVisible({ timeout: 15_000 });
    await feeInputs.first().fill('10.0');
    await expect(feeInputs.first()).toHaveValue('10.0');
  });
});

test.describe('Admin: Verification Queue', () => {
  test('renders page', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/verification', 'admin');

    await expectPageLoaded(page, /Verification Queue/i);
    await expectNotErrorPage(page);
    await expectTableOrEmpty(page);
  });
});

test.describe('Admin: Reviews', () => {
  test('renders reviews page', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/reviews', 'admin');

    await expectPageLoaded(page, /Flagged Reviews/i);
    await expectNotErrorPage(page);
    await expect(
      page
        .getByLabel(/Filter flags by status|Filter.*status/i)
        .or(page.getByRole('combobox'))
        .or(page.locator('table'))
        .or(page.getByText(/no .* found|no results|no .* yet|queue is empty/i))
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Admin: Fraud Detection', () => {
  test('renders fraud page', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/fraud', 'admin');

    await expectPageLoaded(page, /Fraud Detection/i);
    await expectNotErrorPage(page);
    await expect(
      page
        .getByRole('heading', { name: /Fraud Alerts/i })
        .or(page.getByText(/Open Alerts|Critical Alerts|Open Signals/i))
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Admin: Platform Settings', () => {
  test('renders platform page', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/platform', 'admin');

    await expectPageLoaded(page, /Platform Analytics/i);
    await expectNotErrorPage(page);
    await expect(
      page
        .getByText(/Total Users|Jobs Posted|Total GMV|Avg Bids per Job/i)
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Admin: Taxonomy', () => {
  test('renders taxonomy page', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/taxonomy', 'admin');

    await expectPageLoaded(page, /Service Taxonomy/i);
    await expectNotErrorPage(page);
    await expect(
      page.getByText(/Categories|Subcategories|Service types|service types/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Admin: Guarantee Claims', () => {
  test('renders guarantee claims page', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/guarantee', 'admin');

    await expectPageLoaded(page, /Guarantee Claims/i);
    await expectNotErrorPage(page);
    await expectTableOrEmpty(page);
  });
});

test.describe('Admin: Challenges', () => {
  test('renders challenges page', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/challenges', 'admin');

    await expectPageLoaded(page, /Challenge Management/i);
    await expectNotErrorPage(page);
    await expect(
      page
        .getByText(/Create and manage provider challenges|seasonal events/i)
        .or(page.getByRole('button', { name: /Create|Add|New/i }))
        .or(page.getByRole('tab'))
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Admin: Advances', () => {
  test('renders advances page', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/advances', 'admin');

    await expectPageLoaded(page, /Working Capital Advances/i);
    await expectNotErrorPage(page);
    await expectTableOrEmpty(page);
  });
});

test.describe('Admin: Regular Page Access', () => {
  test('admin can access /dashboard', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/dashboard', 'admin');

    // Dashboard h1 is a greeting: "Good morning/afternoon/evening"
    await expect(
      page.getByRole('heading', { name: /Good (morning|afternoon|evening)/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 });
    await expectNotErrorPage(page);
  });

  test('admin can access /profile', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/profile', 'admin');

    await expectPageLoaded(page, /My Profile/i);
    await expectNotErrorPage(page);
    await expect(page.getByText(/admin@nomarkup\.com/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('admin can access /jobs', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/jobs', 'admin');

    await expectPageLoaded(page, /Find\s+Jobs/i);
    await expectNotErrorPage(page);
    await expect(
      page.getByPlaceholder(/search|find/i).or(page.getByRole('combobox')).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
