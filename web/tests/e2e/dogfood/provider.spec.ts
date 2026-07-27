import { test } from '@playwright/test';

import {
  expect,
  expectNavSidebar,
  expectNotErrorPage,
  expectPageLoaded,
  loginAs,
  navigateTo,
} from './fixtures';

/* ------------------------------------------------------------------ */
/*  Provider E2E Dogfooding Tests                                      */
/*  Persona: provider@nomarkup.com  (role: provider, "Mike Provider") */
/*  Credentials sourced from SEED_PASSWORD env var via fixtures.ts     */
/* ------------------------------------------------------------------ */

test.describe('Provider: Login & Dashboard', () => {
  test('logs in and sees dashboard with provider stat cards', async ({ page }) => {
    await loginAs(page, 'provider');

    // Dashboard h1 is a greeting: "Good morning/afternoon/evening, Mike"
    await expect(
      page.getByRole('heading', { name: /Good (morning|afternoon|evening)/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 });

    // Provider stat cards are h3 headings (use .first() — some names appear in multiple sections)
    for (const name of ['Active Bids', 'Active Contracts', 'Total Earnings', 'Win Rate']) {
      await expect(page.getByRole('heading', { name, level: 3 }).first()).toBeVisible({
        timeout: 10_000,
      });
    }

    // Provider-specific quick actions (use link role to avoid matching empty-state text)
    await expect(page.getByRole('link', { name: /Browse Jobs/i })).toBeVisible();

    await expectNavSidebar(page);
  });
});

test.describe('Provider: Provider Dashboard', () => {
  test('loads /provider and shows provider-specific content', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/provider', 'provider');

    await expectPageLoaded(page, /Provider Dashboard/i);
    await expectNotErrorPage(page);

    // Stat cards
    await expect(page.getByText('Active Bids', { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('Jobs Completed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Total Earnings', { exact: true }).first()).toBeVisible();

    // Edit profile link/button
    await expect(
      page
        .getByRole('link', { name: /Edit Profile/i })
        .or(page.getByRole('button', { name: /Edit Profile/i }))
        .first(),
    ).toBeVisible({ timeout: 10_000 });

    // Trust Score section (provider-specific chrome — not "any heading")
    await expect(page.getByText(/Trust Score/i).first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Provider: Onboarding', () => {
  test('loads onboarding page and shows step 1 form fields', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/provider/onboarding', 'provider');

    await expectPageLoaded(page, /Provider Setup/i);
    await expectNotErrorPage(page);

    // Step indicator
    const stepText = page.getByText(/Step \d+ of \d+/i);
    await expect(stepText.first()).toBeVisible({ timeout: 10_000 });

    // Business info fields (step 1)
    const businessName = page
      .getByLabel(/Business Name/i)
      .or(page.getByPlaceholder(/business name/i));
    const bio = page.getByLabel(/Bio/i).or(page.getByPlaceholder(/bio/i));

    // At least one form field should be visible on step 1
    await expect(businessName.or(bio).first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Provider: Browse Jobs', () => {
  test('loads /jobs and shows search or filter UI', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/jobs', 'provider');

    await expectPageLoaded(page, /Find\s+Jobs/i);
    await expectNotErrorPage(page);

    await expect(
      page.getByPlaceholder(/search|find/i).or(page.getByRole('combobox')).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Provider: My Bids', () => {
  test('loads /bids and shows tabs', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/bids', 'provider');

    await expectPageLoaded(page, /My Bids/i);
    await expectNotErrorPage(page);

    const tabLabels = ['All', 'Active', 'Won', 'Lost'];
    for (const label of tabLabels) {
      const tab = page.getByRole('tab', { name: new RegExp(`^${label}$`, 'i') });
      await expect(tab).toBeVisible();
    }
  });

  test('clicking each bid tab does not error', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/bids', 'provider');
    await expectPageLoaded(page, /My Bids/i);

    for (const label of ['Active', 'Won', 'Lost', 'All']) {
      const tab = page.getByRole('tab', { name: new RegExp(`^${label}$`, 'i') });
      await tab.click();
      await page.waitForTimeout(500);
      await expectNotErrorPage(page);
    }
  });
});

test.describe('Provider: Contracts', () => {
  test('loads /contracts and shows heading and tabs', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/contracts', 'provider');

    await expectPageLoaded(page, /Contracts/i);
    await expectNotErrorPage(page);

    const tabLabels = ['All', 'Pending', 'Active', 'Completed', 'Cancelled'];
    for (const label of tabLabels) {
      await expect(page.getByRole('tab', { name: new RegExp(`^${label}$`, 'i') })).toBeVisible();
    }
  });
});

test.describe('Provider: Payments', () => {
  test('loads /payments and shows heading', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/payments', 'provider');

    await expectPageLoaded(page, /Payments/i);
    await expectNotErrorPage(page);

    const tabLabels = ['All', 'Pending', 'Escrow', 'Completed', 'Failed', 'Refunded'];
    for (const label of tabLabels) {
      await expect(page.getByRole('tab', { name: new RegExp(`^${label}$`, 'i') })).toBeVisible();
    }
  });
});

test.describe('Provider: Team', () => {
  test('loads /provider/team page', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/provider/team', 'provider');

    await expectPageLoaded(page, /Team Management/i);
    await expectNotErrorPage(page);
    await expect(
      page
        .getByRole('button', { name: /Add Employee/i })
        .or(page.getByText(/No team members yet|Manage your company employees/i))
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Provider: Business Tools', () => {
  test('invoices page loads', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/provider/business/invoices', 'provider');

    await expectPageLoaded(page, /Invoices/i);
    await expectNotErrorPage(page);
    await expect(
      page
        .getByText(/No completed contracts|Completed Contracts|View and print invoices/i)
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('expenses page loads', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/provider/business/expenses', 'provider');

    await expectPageLoaded(page, /Expense Tracking/i);
    await expectNotErrorPage(page);
    await expect(
      page
        .getByRole('heading', { name: /Add Expense/i })
        .or(page.getByLabel(/Amount|expense-amount|Date/i))
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('tax page loads', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/provider/business/tax', 'provider');

    await expectPageLoaded(page, /Tax Center/i);
    await expectNotErrorPage(page);
    await expect(
      page
        .getByText(/Earnings Summary|Track earnings|tax year/i)
        .or(page.getByLabel(/Select tax year/i))
        .or(page.getByRole('combobox'))
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Provider: Working Capital', () => {
  test('loads /provider/advances page', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/provider/advances', 'provider');

    await expectPageLoaded(page, /Working Capital/i);
    await expectNotErrorPage(page);
    await expect(
      page
        .getByText(/Total Advanced|Outstanding Balance|Available Credit|Request Advance/i)
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Provider: Challenges', () => {
  test('loads /provider/challenges page', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/provider/challenges', 'provider');

    await expectPageLoaded(page, /Challenges/i);
    await expectNotErrorPage(page);
    await expect(
      page
        .getByRole('tab', { name: /Available|In Progress|Completed/i })
        .or(page.getByText(/Complete challenges to earn rewards/i))
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Provider: Analytics', () => {
  test('loads /analytics and shows provider metrics', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/analytics', 'provider');

    await expectPageLoaded(page, /Analytics/i);
    await expectNotErrorPage(page);
    await page.waitForTimeout(3_000);

    // Provider analytics chrome — not "any heading" (QA-07).
    await expect(
      page
        .getByText(/Win Rate/i)
        .or(page.getByText(/On-Time Rate/i))
        .or(page.getByText(/Total Earnings|Active Bids|Jobs Completed/i))
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Provider: Profile', () => {
  test('shows provider role badge and provider information', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/profile', 'provider');

    await expectPageLoaded(page, /My Profile/i);
    await expectNotErrorPage(page);
    await page.waitForTimeout(2_000);

    // Seed provider identity + role badge (QA-07)
    await expect(page.getByText(/provider@nomarkup\.com/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/^provider$/i).first()).toBeVisible({ timeout: 10_000 });

    // Provider Information card when profile API has loaded
    const providerInfo = page.getByText(/Provider Information/i);
    if ((await providerInfo.count()) > 0) {
      await expect(providerInfo.first()).toBeVisible();
    }
  });
});

test.describe('Provider: Payment Methods', () => {
  test('loads /settings/payment-methods with provider payouts section', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/settings/payment-methods', 'provider');

    await expectPageLoaded(page, /Payment Methods/i);
    await expectNotErrorPage(page);

    // Provider Payouts section (Stripe Connect) must be visible
    await expect(page.getByText(/Provider Payouts|Stripe|Payout/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe('Provider: Messages', () => {
  test('loads /messages page', async ({ page }) => {
    await loginAs(page, 'provider');
    await navigateTo(page, '/messages', 'provider');

    await expectPageLoaded(page, /Messages/i);
    await expectNotErrorPage(page);
    await expectNavSidebar(page);
    await expect(
      page
        .getByText(/Select a conversation|No messages yet/i)
        .or(page.getByRole('listitem'))
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
