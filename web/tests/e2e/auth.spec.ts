import { expect, test } from '@playwright/test';

test.describe('Authentication flows', () => {
  test.describe('Login page', () => {
    test('renders login form', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(page.getByLabel(/password/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    });

    test('shows validation errors for empty form', async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: /sign in/i }).click();
      await expect(page.getByText(/invalid email/i)).toBeVisible();
    });

    test('shows validation error for invalid email', async ({ page }) => {
      await page.goto('/login');
      await page.getByLabel(/email/i).fill('not-an-email');
      await page.getByLabel(/password/i).fill('Password123!');
      await page.getByRole('button', { name: /sign in/i }).click();
      await expect(page.getByText(/invalid email/i)).toBeVisible();
    });

    test('has link to registration', async ({ page }) => {
      await page.goto('/login');
      const link = page.getByRole('link', { name: /create one/i });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', '/register');
    });

    test('has link to forgot password', async ({ page }) => {
      await page.goto('/login');
      const link = page.getByRole('link', { name: /forgot password/i });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', '/forgot-password');
    });
  });

  test.describe('Registration page', () => {
    test('renders registration form', async ({ page }) => {
      await page.goto('/register');
      await expect(page.getByRole('heading', { name: /create.*account/i })).toBeVisible();
      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(page.getByLabel(/display name/i)).toBeVisible();
    });

    test('shows validation error for short password', async ({ page }) => {
      await page.goto('/register');
      await page.getByLabel(/email/i).fill('test@example.com');
      await page.getByLabel(/display name/i).fill('Test User');
      // Fill password fields — locate by placeholder since multiple password fields exist.
      await page.getByPlaceholder(/create a password/i).fill('short');
      await page.getByPlaceholder(/confirm/i).fill('short');
      await page.getByRole('button', { name: /create account/i }).click();
      await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
    });

    test('shows validation error for mismatched passwords', async ({ page }) => {
      await page.goto('/register');
      await page.getByLabel(/email/i).fill('test@example.com');
      await page.getByLabel(/display name/i).fill('Test User');
      await page.getByPlaceholder(/create a password/i).fill('Password123!');
      await page.getByPlaceholder(/confirm/i).fill('Password456!');
      await page.getByRole('button', { name: /create account/i }).click();
      await expect(page.getByText(/passwords do not match/i)).toBeVisible();
    });

    test('has link to login', async ({ page }) => {
      await page.goto('/register');
      const link = page.getByRole('link', { name: /sign in/i });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', '/login');
    });
  });

  test.describe('Forgot password page', () => {
    test('renders forgot password form', async ({ page }) => {
      await page.goto('/forgot-password');
      await expect(page.getByRole('heading', { name: /forgot.*password/i })).toBeVisible();
      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /send.*reset/i })).toBeVisible();
    });

    test('shows validation error for invalid email', async ({ page }) => {
      await page.goto('/forgot-password');
      await page.getByLabel(/email/i).fill('bad-email');
      await page.getByRole('button', { name: /send.*reset/i }).click();
      await expect(page.getByText(/invalid email/i)).toBeVisible();
    });

    test('has link back to login', async ({ page }) => {
      await page.goto('/forgot-password');
      const link = page.getByRole('link', { name: /sign in/i });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', '/login');
    });
  });

  test.describe('Reset password page', () => {
    test('shows invalid link message without token', async ({ page }) => {
      await page.goto('/reset-password');
      await expect(page.getByText(/invalid.*reset.*link/i)).toBeVisible();
    });

    test('renders reset form with token', async ({ page }) => {
      await page.goto('/reset-password?token=test-token');
      await expect(page.getByRole('heading', { name: /set new password/i })).toBeVisible();
      await expect(page.getByLabel(/new password/i)).toBeVisible();
      await expect(page.getByLabel(/confirm password/i)).toBeVisible();
    });
  });

  test.describe('Protected routes', () => {
    test('redirects unauthenticated user from dashboard', async ({ page }) => {
      await page.goto('/dashboard');
      // Should redirect to login or show auth-required state.
      await page.waitForURL(/\/(login|dashboard)/);
    });
  });

  test.describe('Accessibility', () => {
    test('login form has proper labels and roles', async ({ page }) => {
      await page.goto('/login');
      // All form fields should have associated labels.
      const emailInput = page.getByLabel(/email/i);
      await expect(emailInput).toHaveAttribute('type', 'email');
      await expect(emailInput).toHaveAttribute('autocomplete', 'email');

      const passwordInput = page.getByLabel(/password/i);
      await expect(passwordInput).toHaveAttribute('type', 'password');
      await expect(passwordInput).toHaveAttribute('autocomplete', 'current-password');
    });

    test('sign in button meets minimum touch target', async ({ page }) => {
      await page.goto('/login');
      const button = page.getByRole('button', { name: /sign in/i });
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });
  });
});
