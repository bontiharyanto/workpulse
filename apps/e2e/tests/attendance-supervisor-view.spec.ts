import { expect, test } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';
import { loginAs } from './helpers/login';

/**
 * Supervisor team view — asserts the roster join + tab wiring, not the
 * details of any single row's status. The scenario:
 *
 *   1. Supervisor logs in and navigates to `/attendance/team`.
 *   2. The "Hari ini" table renders the direct-report roster (which for
 *      the seed is just Employee One — the only user with
 *      `supervisorId = lead@acme.test`).
 *   3. Switching to the "Rekap" tab renders a table with the same
 *      employee row and the summary column headings.
 *
 * We DO NOT assert on the clock-in status because we don't clock the
 * employee in as part of this spec — status may be NOT_CLOCKED_IN, ABSENT,
 * or ON_TIME depending on when the test runs and what other specs did.
 * That flakiness is best kept out of the assertions here.
 */
test.describe.configure({ mode: 'serial' });

test('supervisor: team view renders roster on both tabs', async ({ page }) => {
  await loginAs(page, 'supervisor');
  await page.goto('/attendance/team');

  await expect(page.getByRole('heading', { name: 'Kehadiran Tim', exact: true })).toBeVisible();

  // ---- Hari ini tab (default) --------------------------------------------
  const todayHeader = page.getByRole('columnheader', { name: 'Status', exact: true });
  await expect(todayHeader).toBeVisible({ timeout: 10_000 });

  // The seed's employee is the only report; assert their name appears in
  // the roster's Nama cell. The cell's accessible name is
  // "Employee One employee@acme.test" (fullName + email in stacked
  // <div>s), so `exact: true` on the fullName alone can't match — use
  // `hasText` filtering instead, which does a substring search.
  const employeeName = SEED_USERS.employee.fullName;
  const nameCellToday = page.getByRole('cell').filter({ hasText: employeeName });
  await expect(nameCellToday.first()).toBeVisible({ timeout: 10_000 });

  // ---- Rekap tab ---------------------------------------------------------
  // The Rekap / Hari ini toggle and the 7/14/30-day range preset are
  // implemented with Radix `Tabs`, so they expose `role="tab"` (not
  // `role="button"`). Labels are the full form "7 hari" / "14 hari".
  await page.getByRole('tab', { name: 'Rekap', exact: true }).click();

  await expect(page.getByRole('tab', { name: '7 hari', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '14 hari', exact: true })).toBeVisible();

  // Employee row is still present in the summary reducer output.
  const nameCellRekap = page.getByRole('cell').filter({ hasText: employeeName });
  await expect(nameCellRekap.first()).toBeVisible({ timeout: 10_000 });
});

test('employee: /attendance/team is not linked from the landing page', async ({ page }) => {
  await loginAs(page, 'employee');
  await page.goto('/attendance');

  // The role-gated link component renders `null` for EMPLOYEE; the button
  // must not be in the DOM at all (not just hidden).
  await expect(page.getByRole('link', { name: /Kehadiran Tim/i })).toHaveCount(0);
});
