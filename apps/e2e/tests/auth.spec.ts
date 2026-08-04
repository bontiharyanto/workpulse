import { expect, test } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';
import { loginAs } from './helpers/login';

test.describe('Authentication', () => {
  test('valid credentials redirect the user into the dashboard shell', async ({ page }) => {
    await loginAs(page, 'employee');

    // The dashboard shell embeds the primary nav — asserting on it proves
    // that (a) the session cookie was accepted, and (b) the app-shell
    // client bundle hydrated. Both are things that silently break in
    // production more often than the login form itself.
    await expect(page.getByRole('link', { name: /Kehadiran/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Cuti/i })).toBeVisible();
  });

  test('invalid credentials keep the user on /login and surface an error', async ({ page }) => {
    await page.goto('/login');

    await page.locator('#email').fill(SEED_USERS.employee.email);
    await page.locator('#password').fill('definitely-the-wrong-password');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();

    // The form uses role="alert" for its inline error message — we assert
    // on that role rather than the copy so tweaks to the Indonesian text
    // don't break the test.
    const alert = page.getByRole('alert');
    await expect(alert.first()).toBeVisible({ timeout: 8_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('unauthenticated visit to a protected route bounces to /login', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/leave');
    await expect(page).toHaveURL(/\/login/, { timeout: 8_000 });
  });
});
