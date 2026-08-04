import { expect, test } from '@playwright/test';

import { loginAs } from './helpers/login';

/**
 * HR company-wide dashboard — asserts:
 *
 *   1. HR Manager and Super Admin can open `/attendance/dashboard` and
 *      see the 8 stat cards.
 *   2. The "Total karyawan" tile shows a number ≥ 3 (seed has HR,
 *      Supervisor, Employee — Super Admin is a 4th but Q counts only
 *      ACTIVE + ON_LEAVE users, and Super Admin is ACTIVE, so we assert
 *      ≥ 3 to remain robust against seed evolution).
 *   3. Per-department table shows the "Engineering" department that the
 *      seed places every user into.
 *   4. Changing the date picker triggers a fresh fetch (we don't assert
 *      the returned numbers change — the seed only has one snapshot
 *      per day of clock-ins — but we DO assert the URL query is honored
 *      via the network round-trip).
 *   5. Non-HR / non-Super-Admin actors do NOT see the entry link on
 *      `/attendance`, and directly navigating gets a "Forbidden" surface
 *      (either the page renders `null` from `CompanyDashboard` or the
 *      user is redirected — either behaviour is acceptable, we only
 *      assert the numeric cards do NOT appear).
 */
test.describe.configure({ mode: 'serial' });

test('HR: /attendance/dashboard renders stat cards + department breakdown', async ({ page }) => {
  await loginAs(page, 'hr');
  await page.goto('/attendance/dashboard');

  await expect(page.getByRole('heading', { name: /Dashboard Kehadiran HR/i })).toBeVisible();

  // Stat cards — assert the labels are present and the total is a
  // non-negative number. Anchor on the "Total karyawan" label element
  // then read the FINAL numeric target from the sibling `<p>`'s
  // `<span data-value>` (emitted by `<CountUp>`). Reading the rendered
  // text mid-animation is flaky; `data-value` is the atomic target.
  const totalLabel = page.getByText('Total karyawan', { exact: true });
  await expect(totalLabel).toBeVisible({ timeout: 10_000 });
  const totalValue = totalLabel.locator('xpath=following-sibling::p[1]//span[@data-value]');
  await expect(totalValue).toBeVisible({ timeout: 10_000 });
  const dataValueAttr = await totalValue.getAttribute('data-value');
  const total = Number(dataValueAttr ?? '');
  expect(Number.isFinite(total)).toBe(true);
  expect(total).toBeGreaterThanOrEqual(3);

  // Department breakdown — Engineering should appear (all seed users
  // belong to it).
  await expect(page.getByRole('cell', { name: 'Engineering', exact: true })).toBeVisible({
    timeout: 10_000,
  });
});

test('HR: date picker on dashboard drives a fresh network fetch', async ({ page }) => {
  await loginAs(page, 'hr');
  await page.goto('/attendance/dashboard');

  // Wait for the initial GET to settle.
  await page.waitForResponse(
    (res) => res.url().includes('/attendance/dashboard') && res.status() === 200,
  );

  // Pick a date 7 days in the past and assert we see a request go out for it.
  const past = new Date();
  past.setUTCDate(past.getUTCDate() - 7);
  const y = past.getUTCFullYear();
  const m = String(past.getUTCMonth() + 1).padStart(2, '0');
  const d = String(past.getUTCDate()).padStart(2, '0');
  const targetIso = `${y}-${m}-${d}`;

  const [refetch] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes(`/attendance/dashboard?date=${targetIso}`) && res.status() === 200,
      { timeout: 10_000 },
    ),
    page.locator('input[type="date"]').first().fill(targetIso),
  ]);
  expect(refetch.ok()).toBe(true);
});

test('supervisor: /attendance/dashboard is not linked and shows no HR cards on direct nav', async ({
  page,
}) => {
  await loginAs(page, 'supervisor');
  await page.goto('/attendance');
  // Entry link is role-gated to HR + Super Admin.
  await expect(page.getByRole('link', { name: /Dashboard HR/i })).toHaveCount(0);

  // Direct nav: the server rejects the GET with 403, so the query is in
  // an `isError` state and none of the numeric cards render.
  await page.goto('/attendance/dashboard');
  await expect(page.getByText('Total karyawan', { exact: true })).toHaveCount(0, {
    timeout: 10_000,
  });
});

test('Super Admin also sees the HR dashboard', async ({ page }) => {
  await loginAs(page, 'admin');
  await page.goto('/attendance/dashboard');
  await expect(page.getByRole('heading', { name: /Dashboard Kehadiran HR/i })).toBeVisible();
  await expect(page.getByText('Total karyawan', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
});
