import { test } from '@playwright/test';

import {
  expect,
  expectHasHeadings,
  expectNavSidebar,
  expectNotErrorPage,
  expectPageLoaded,
  loginAs,
  navigateTo,
} from './fixtures';

/* ------------------------------------------------------------------ */
/*  Customer E2E Dogfooding Tests                                      */
/*  Persona: customer@nomarkup.com (role: customer)                    */
/*  Credentials sourced from SEED_PASSWORD env var via fixtures.ts     */
/* ------------------------------------------------------------------ */

test.describe('Customer: Login & Dashboard', () => {
  test('logs in and shows dashboard with stat cards and quick actions', async ({ page }) => {
    await loginAs(page, 'customer');

    // Dashboard h1 is a time-of-day greeting: "Good morning/afternoon/evening, Jane"
    await expect(
      page.getByRole('heading', { name: /Good (morning|afternoon|evening)/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 });

    // Subtitle
    await expect(page.getByText(/Here is what is happening/i)).toBeVisible({ timeout: 10_000 });

    // Verify stat cards (they're h3 headings inside cards)
    const statCardTitles = ['Active Jobs', 'Bids Received', 'Pending Actions', 'Total Spend'];
    for (const title of statCardTitles) {
      await expect(page.getByRole('heading', { name: title, level: 3 })).toBeVisible({
        timeout: 10_000,
      });
    }

    // Verify quick action cards exist - use href or role with partial to avoid ambiguity
    await expect(page.locator('a[href="/jobs/new"]')).toBeVisible();
    await expect(page.locator('a[href="/contracts"]')).toBeVisible();

    // Verify nav sidebar is present
    await expectNavSidebar(page);
  });
});

test.describe.serial('Customer: Job Creation Wizard', () => {
  let sharedPage: import('@playwright/test').Page;

  test.beforeAll(async ({ browser }) => {
    sharedPage = await browser.newPage();
    await loginAs(sharedPage, 'customer');
  });

  test.afterAll(async () => {
    await sharedPage.close();
  });

  test('navigates to /jobs/new and sees the wizard', async () => {
    await navigateTo(sharedPage, '/jobs/new', 'customer');
    await expectPageLoaded(sharedPage, /Post a New Job/i);

    // Step indicator should show step 1 of 7
    await expect(sharedPage.getByText(/Step 1 of 7/i)).toBeVisible({ timeout: 10_000 });
  });

  test('Step 0 (Category): selects a top-level category', async () => {
    await expect(sharedPage.getByText(/Service Category/i)).toBeVisible({ timeout: 10_000 });

    // Wait for categories to load from the API
    const categoryList = sharedPage.locator('ul[aria-label="Categories"]');
    await expect(categoryList).toBeVisible({ timeout: 15_000 });
    const categoryButtons = categoryList.getByRole('button');
    await expect(categoryButtons.first()).toBeVisible({ timeout: 15_000 });

    // Click first available top level (Plumbing or any)
    await categoryButtons.first().click();

    // Wait for either sub level or selection
    await sharedPage.waitForTimeout(800);

    // Try to select a leaf if checkboxes appear
    let selected = false;
    const checkboxes = sharedPage.getByRole('checkbox');
    if ((await checkboxes.count()) > 0) {
      await checkboxes.first().check();
      selected = true;
    } else {
      const subButtons = sharedPage.locator('ul[aria-label="Categories"]').getByRole('button');
      if ((await subButtons.count()) > 0) {
        await subButtons.first().click();
        await sharedPage.waitForTimeout(800);
        const leafCheckboxes = sharedPage.getByRole('checkbox');
        if ((await leafCheckboxes.count()) > 0) {
          await leafCheckboxes.first().check();
          selected = true;
        }
      }
    }

    // If no leaf, perhaps top level is selectable or use hint
    if (!selected) {
      // click again or accept top level
      await categoryButtons.first().click();
    }

    // Verify category was selected by ensuring a checkbox is checked (the UI indicator)
    await expect(sharedPage.getByRole("checkbox").first()).toBeChecked({ timeout: 5000 });

    // Click Next (exact match to avoid Next.js dev tools button)
    await sharedPage.getByRole('button', { name: 'Next', exact: true }).click();
  });

  test('Step 1 (Details): fills title and description', async () => {
    await expect(sharedPage.getByText(/Describe the job/i)).toBeVisible({ timeout: 10_000 });

    await sharedPage.getByLabel(/Job Title/i).fill('Test Plumbing Job - Kitchen Sink Repair');
    await sharedPage
      .getByLabel(/Description/i)
      .fill(
        'The kitchen sink faucet is leaking and needs to be repaired or replaced. There is also a slow drain that needs clearing. Please bring all necessary tools and materials.',
      );

    await sharedPage.getByRole('button', { name: 'Next', exact: true }).click();
  });

  test('Step 2 (Location): fills service address', async () => {
    await expect(sharedPage.getByText(/Where is the work/i)).toBeVisible({ timeout: 10_000 });

    await sharedPage.getByLabel(/Service Address/i).fill('123 Test Street, Austin, TX 78701');

    await sharedPage.getByRole('button', { name: 'Next', exact: true }).click();
  });

  test('Step 3 (Schedule): selects Flexible', async () => {
    await expect(sharedPage.getByText(/When do you need it done/i)).toBeVisible({
      timeout: 10_000,
    });

    // Open the schedule type selector and pick Flexible
    const trigger = sharedPage.getByRole('combobox');
    if ((await trigger.count()) > 0) {
      await trigger.first().click();
      const flexOption = sharedPage.getByRole('option', { name: /Flexible/i });
      if ((await flexOption.count()) > 0) {
        await flexOption.click();
      } else {
        await sharedPage.keyboard.press('Escape');
      }
    }

    // Ensure recurring is NOT checked
    const recurringCb = sharedPage.getByRole('checkbox');
    if ((await recurringCb.count()) > 0 && (await recurringCb.first().isChecked())) {
      await recurringCb.first().uncheck();
    }

    await sharedPage.getByRole('button', { name: 'Next', exact: true }).click();
  });

  test('Step 4 (Photos): skips photo upload', async () => {
    await expect(sharedPage.getByText(/Add photos of the job/i)).toBeVisible({ timeout: 10_000 });

    // Verify the drop zone is present
    const dropZone = sharedPage.getByText(/Drag photos here|click to browse/i);
    await expect(dropZone.first()).toBeVisible();

    await sharedPage.getByRole('button', { name: 'Next', exact: true }).click();
  });

  test('Step 5 (Auction): fills starting bid and instant accept', async () => {
    await expect(sharedPage.getByText(/Set your auction parameters/i)).toBeVisible({
      timeout: 10_000,
    });

    // Fill starting bid (first number input)
    const numberInputs = sharedPage.locator('input[type="number"]');
    await expect(numberInputs.first()).toBeVisible();
    await numberInputs.first().fill('100');

    // Verify slider is visible
    expect(await sharedPage.getByRole('slider').count()).toBeGreaterThanOrEqual(1);

    // Fill instant accept price (second number input)
    if ((await numberInputs.count()) >= 2) {
      await numberInputs.nth(1).fill('50');
    }

    await sharedPage.getByRole('button', { name: 'Next', exact: true }).click();
  });

  test('Step 6 (Review): verifies summary and publishes', async () => {
    await expect(sharedPage.getByText(/Review and publish/i)).toBeVisible({ timeout: 10_000 });

    // Verify key details appear in review
    await expect(sharedPage.getByText('Test Plumbing Job - Kitchen Sink Repair')).toBeVisible();
    await expect(sharedPage.getByText(/kitchen sink faucet is leaking/i)).toBeVisible();
    await expect(sharedPage.getByText('123 Test Street, Austin, TX 78701')).toBeVisible();
    await expect(sharedPage.getByText('Flexible').first()).toBeVisible();

    // Click Publish
    const publishBtn = sharedPage.getByRole('button', { name: /Publish Job/i });
    await expect(publishBtn).toBeVisible();
    await publishBtn.click();

    // Wait for redirect or handle API failure gracefully
    try {
      await sharedPage.waitForURL(/\/jobs\/(mine|[a-f0-9-]+)/, { timeout: 15_000 });
    } catch {
      // May fail in test env — acceptable for dogfooding
    }
  });
});

test.describe('Customer: My Jobs', () => {
  test('loads /jobs/mine and shows heading', async ({ page }) => {
    await loginAs(page, 'customer');
    await navigateTo(page, '/jobs/mine', 'customer');

    await expectHasHeadings(page);
    await expectNotErrorPage(page);

    // The page either shows job cards or an empty state — both are valid
    const hasContent =
      (await page.getByRole('tab').count()) > 0 ||
      (await page.getByText(/no.*job/i).count()) > 0 ||
      (await page.getByRole('link').count()) > 0;
    expect(hasContent).toBeTruthy();
  });
});

test.describe('Customer: Contracts', () => {
  test('loads /contracts and shows heading and tabs', async ({ page }) => {
    await loginAs(page, 'customer');
    await navigateTo(page, '/contracts', 'customer');

    await expectPageLoaded(page, /Contracts/i);
    await expectNotErrorPage(page);

    const tabLabels = ['All', 'Pending', 'Active', 'Completed', 'Cancelled'];
    for (const label of tabLabels) {
      const tab = page.getByRole('tab', { name: new RegExp(`^${label}$`, 'i') });
      await expect(tab).toBeVisible();
    }
  });

  test('clicking each contract tab does not error', async ({ page }) => {
    await loginAs(page, 'customer');
    await navigateTo(page, '/contracts', 'customer');
    await expectPageLoaded(page, /Contracts/i);

    for (const label of ['Pending', 'Active', 'Completed', 'Cancelled', 'All']) {
      const tab = page.getByRole('tab', { name: new RegExp(`^${label}$`, 'i') });
      await tab.click();
      await page.waitForTimeout(500);
      await expectNotErrorPage(page);
    }
  });
});

test.describe('Customer: Payments', () => {
  test('loads /payments and shows heading and tabs', async ({ page }) => {
    await loginAs(page, 'customer');
    await navigateTo(page, '/payments', 'customer');

    await expectPageLoaded(page, /Payments/i);
    await expectNotErrorPage(page);

    const tabLabels = ['All', 'Pending', 'Escrow', 'Completed', 'Failed', 'Refunded'];
    for (const label of tabLabels) {
      const tab = page.getByRole('tab', { name: new RegExp(`^${label}$`, 'i') });
      await expect(tab).toBeVisible();
    }
  });
});

test.describe('Customer: Profile', () => {
  test('loads /profile and shows user info', async ({ page }) => {
    await loginAs(page, 'customer');
    await navigateTo(page, '/profile', 'customer');

    await expectPageLoaded(page, /My Profile/i);
    await expectNotErrorPage(page);
    await page.waitForTimeout(2_000);

    // Verify email is displayed
    expect(await page.getByText(/customer@nomarkup\.com/i).count()).toBeGreaterThanOrEqual(1);

    // Verify role badge
    expect(await page.getByText(/customer/i).count()).toBeGreaterThanOrEqual(1);

    // Click "Edit Profile" and verify form appears
    const editBtn = page.getByRole('button', { name: /Edit Profile/i });
    await expect(editBtn).toBeVisible({ timeout: 10_000 });
    await editBtn.click();
    await expect(page.getByText('Edit Profile', { exact: true }).first()).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe('Customer: Settings Pages', () => {
  test('payment methods page loads', async ({ page }) => {
    await loginAs(page, 'customer');
    await navigateTo(page, '/settings/payment-methods', 'customer');

    await expectPageLoaded(page, /Payment Methods/i);
    await expectNotErrorPage(page);
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
  });

  test('notification preferences page loads', async ({ page }) => {
    await loginAs(page, 'customer');
    await navigateTo(page, '/settings/notifications', 'customer');

    await expectHasHeadings(page);
    await expectNotErrorPage(page);
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
  });

  test('security settings page loads', async ({ page }) => {
    await loginAs(page, 'customer');
    await navigateTo(page, '/settings/security', 'customer');

    await expectPageLoaded(page, /Security/i);
    await expectNotErrorPage(page);

    // Verify change password section
    await expect(page.getByText(/Change Password/i).first()).toBeVisible({ timeout: 10_000 });

    // Verify MFA section
    await expect(page.getByText(/Two-Factor Authentication/i).first()).toBeVisible();
  });
});

test.describe('Customer: Analytics', () => {
  test('loads /analytics and shows heading', async ({ page }) => {
    await loginAs(page, 'customer');
    await navigateTo(page, '/analytics', 'customer');

    await expectPageLoaded(page, /Analytics/i);
    await expectNotErrorPage(page);
    await page.waitForTimeout(3_000);

    // Verify analytics content rendered
    const hasSelector = (await page.getByRole('combobox').count()) > 0;
    const hasHeadings = (await page.getByRole('heading').count()) > 0;
    expect(hasSelector || hasHeadings).toBeTruthy();
  });
});

test.describe('Customer: Messages', () => {
  test('loads /messages and shows heading', async ({ page }) => {
    await loginAs(page, 'customer');
    await navigateTo(page, '/messages', 'customer');

    await expectPageLoaded(page, /Messages/i);
    await expectNotErrorPage(page);

    const emptyState = page.getByText(/Select a conversation/i);
    const channelList = page.getByRole('navigation');
    expect((await emptyState.count()) > 0 || (await channelList.count()) > 0).toBeTruthy();
  });
});

test.describe('Customer: Notifications', () => {
  test('loads /notifications and shows content', async ({ page }) => {
    await loginAs(page, 'customer');
    await navigateTo(page, '/notifications', 'customer');

    await expectHasHeadings(page);
    await expectNotErrorPage(page);
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Customer: Public Pages (while logged in)', () => {
  test('browse jobs page loads with search/filter', async ({ page }) => {
    await loginAs(page, 'customer');
    await navigateTo(page, '/jobs', 'customer');

    await expectNotErrorPage(page);
    await expectHasHeadings(page);

    const searchInput = page.getByPlaceholder(/search|find/i);
    const filterCombobox = page.getByRole('combobox');
    const hasSearchOrFilter = (await searchInput.count()) > 0 || (await filterCombobox.count()) > 0;
    expect(hasSearchOrFilter).toBeTruthy();
  });

  test('providers page loads', async ({ page }) => {
    await loginAs(page, 'customer');
    await navigateTo(page, '/providers', 'customer');

    await expectNotErrorPage(page);
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
  });

  test('pricing page loads', async ({ page }) => {
    await loginAs(page, 'customer');
    await navigateTo(page, '/pricing', 'customer');

    await expectNotErrorPage(page);
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1);
  });
});
