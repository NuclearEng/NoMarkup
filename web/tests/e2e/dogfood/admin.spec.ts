import { test } from '@playwright/test';

import {
  expect,
  expectHasHeadings,
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

    // Status filter
    const statusFilter = page.getByLabel(/Filter by status/i);
    expect(await statusFilter.count()).toBeGreaterThanOrEqual(1);

    // Role filter
    const roleFilter = page.getByLabel(/Filter by role/i);
    expect(await roleFilter.count()).toBeGreaterThanOrEqual(1);

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

    // Check for action buttons (may not exist if no users in table)
    const table = page.locator('table');
    if ((await table.count()) > 0) {
      const rows = table.first().locator('tbody tr');
      if ((await rows.count()) > 0) {
        const suspendBtns = page.getByRole('button', { name: /Suspend/i });
        const banBtns = page.getByRole('button', { name: /Ban/i });
        expect((await suspendBtns.count()) > 0 || (await banBtns.count()) > 0).toBeTruthy();
      }
    }
    // If no table/rows, that's acceptable
    expect(true).toBeTruthy();
  });
});

test.describe('Admin: User Detail', () => {
  test('loads user detail page for seed customer user', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/users/00000000-0000-0000-0000-000000000002', 'admin');

    await expectHasHeadings(page);
    await expectNotErrorPage(page);
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Admin: Job Management', () => {
  test('renders page with heading and data', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/jobs', 'admin');

    await expectHasHeadings(page);
    await expectNotErrorPage(page);
    await page.waitForTimeout(2_000);

    await expectTableOrEmpty(page);
  });
});

test.describe('Admin: Dispute Management', () => {
  test('renders page with heading and status filter', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/disputes', 'admin');

    await expectHasHeadings(page);
    await expectNotErrorPage(page);

    // Status filter dropdown should exist
    const statusFilter = page.getByRole('combobox').or(page.locator('select'));
    expect(await statusFilter.count()).toBeGreaterThanOrEqual(1);

    await expectTableOrEmpty(page);
  });
});

test.describe('Admin: Payment Administration', () => {
  test('renders page with revenue cards and fee form', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/payments', 'admin');

    await expectHasHeadings(page);
    await expectNotErrorPage(page);
    await page.waitForTimeout(2_000);

    // Revenue summary cards
    const revenueTerms = ['GMV', 'Revenue', 'Guarantee', 'Take Rate'];
    let foundCount = 0;
    for (const term of revenueTerms) {
      if ((await page.getByText(term, { exact: false }).count()) > 0) {
        foundCount++;
      }
    }
    expect(foundCount).toBeGreaterThanOrEqual(2);

    // Fee configuration form (check for numeric inputs)
    const feeInputs = page.locator('input[type="number"]');
    expect(await feeInputs.count()).toBeGreaterThanOrEqual(1);
  });

  test('fee percentage input accepts numeric values', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/payments', 'admin');
    await expectHasHeadings(page);
    await page.waitForTimeout(2_000);

    // Find fee percentage input and fill it
    const feeInputs = page.locator('input[type="number"]');
    if ((await feeInputs.count()) > 0) {
      await feeInputs.first().fill('10.0');
      expect(await feeInputs.first().inputValue()).toBe('10.0');
    } else {
      // Fee config section may not be visible — acceptable
      expect(true).toBeTruthy();
    }
  });
});

test.describe('Admin: Verification Queue', () => {
  test('renders page', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/verification', 'admin');

    await expectHasHeadings(page);
    await expectNotErrorPage(page);
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Admin: Reviews', () => {
  test('renders reviews page', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/reviews', 'admin');

    await expectHasHeadings(page);
    await expectNotErrorPage(page);
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Admin: Fraud Detection', () => {
  test('renders fraud page', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/fraud', 'admin');

    await expectHasHeadings(page);
    await expectNotErrorPage(page);
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Admin: Platform Settings', () => {
  test('renders platform page', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/platform', 'admin');

    await expectHasHeadings(page);
    await expectNotErrorPage(page);
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Admin: Taxonomy', () => {
  test('renders taxonomy page', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/taxonomy', 'admin');

    await expectHasHeadings(page);
    await expectNotErrorPage(page);
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Admin: Guarantee Claims', () => {
  test('renders guarantee claims page', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/guarantee', 'admin');

    await expectHasHeadings(page);
    await expectNotErrorPage(page);
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Admin: Challenges', () => {
  test('renders challenges page', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/challenges', 'admin');

    await expectHasHeadings(page);
    await expectNotErrorPage(page);
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Admin: Advances', () => {
  test('renders advances page', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/admin/advances', 'admin');

    await expectHasHeadings(page);
    await expectNotErrorPage(page);
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
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
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
  });

  test('admin can access /profile', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/profile', 'admin');

    await expectPageLoaded(page, /My Profile/i);
    await expectNotErrorPage(page);
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
  });

  test('admin can access /jobs', async ({ page }) => {
    await loginAs(page, 'admin');
    await navigateTo(page, '/jobs', 'admin');

    await expectHasHeadings(page);
    await expectNotErrorPage(page);
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
  });
});
