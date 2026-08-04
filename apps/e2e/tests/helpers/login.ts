import { expect, type Page } from '@playwright/test';

import { SEED_USERS, type SeedUserKey } from '../fixtures/users';

/**
 * Log in as one of the seeded users and wait for the app-shell to be ready.
 *
 * Split from the specs themselves for two reasons:
 *
 *   1. It's reused across every spec — the login form itself is only worth
 *      testing in `auth.spec.ts`.
 *   2. It centralises the "how do I know login succeeded?" heuristic so a
 *      redesign of the shell only needs to touch one place.
 */
export async function loginAs(page: Page, key: SeedUserKey): Promise<void> {
  const user = SEED_USERS[key];

  await page.goto('/login');
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();

  // The login flow redirects to /attendance by default. We wait for either
  // that URL or any dashboard route (in case the redirect target changes) —
  // whichever fires first.
  await page.waitForURL(/\/(attendance|leave|overtime|admin)/, { timeout: 10_000 });
  await expect(page).not.toHaveURL(/\/login/);
}
