import { expect, test } from '@playwright/test';

import { authenticateApi } from './helpers/api';
import { cancelOvertimeFor } from './helpers/cleanup';
import { nearestPastWeekday } from './helpers/dates';
import { loginAs } from './helpers/login';

/**
 * Overtime end-to-end flow — single-level approval (supervisor).
 *
 * Requires the seed to have configured an overtime hourly rate at either
 * the Company or User level. `apps/api/prisma/seed.ts` was updated in this
 * phase to set `Company.overtimeHourlyRate = 50000` — if that ever changes
 * to null, this test will fail with 400 `OVERTIME_RATE_NOT_CONFIGURED`.
 *
 * Uses the nearest past weekday so:
 *   - The date is inside the default 14-day submit window.
 *   - It's not tagged as WEEKEND (which would blow up if the test runner
 *     ran on a Monday and picked Sunday — a valid business day for OT but
 *     with a different multiplier that we don't care about here).
 */
test.describe.configure({ mode: 'serial' });

test('overtime: employee submits → supervisor approves', async ({ browser }) => {
  const runId = `e2e-ot-${Date.now()}`;
  const workDate = nearestPastWeekday(1);

  // Pre-flight hygiene: cancel any non-terminal overtime the employee
  // may still own for this workDate from a prior partial run. The API's
  // `(userId, workDate)` uniqueness would otherwise fail the submission
  // with 409 DUPLICATE_WORK_DATE and no row would appear in the UI.
  const employeeApi = await authenticateApi('employee');
  await cancelOvertimeFor(employeeApi.api, workDate);
  await employeeApi.api.dispose();

  // ---- Step 1: Employee submits ------------------------------------------
  const employeeCtx = await browser.newContext();
  const employeePage = await employeeCtx.newPage();

  await loginAs(employeePage, 'employee');
  await employeePage.goto('/overtime');

  await employeePage.locator('#ot-workDate').fill(workDate);
  await employeePage.locator('#ot-hours').fill('2.5');
  await employeePage.locator('#ot-reason').fill(`Release deadline — ${runId}`);

  await employeePage.getByRole('button', { name: /^Ajukan lembur$/ }).click();

  await expect(employeePage.getByText(`Release deadline — ${runId}`, { exact: false })).toBeVisible(
    { timeout: 10_000 },
  );

  // ---- Step 2: Supervisor approves ---------------------------------------
  const supervisorCtx = await browser.newContext();
  const supervisorPage = await supervisorCtx.newPage();

  await loginAs(supervisorPage, 'supervisor');
  await supervisorPage.goto('/overtime/approvals');

  const supRow = supervisorPage
    .getByTestId('overtime-approval-row')
    .filter({ hasText: `Release deadline — ${runId}` })
    .first();
  await expect(supRow).toBeVisible({ timeout: 10_000 });
  // The overtime approval UI is a two-step decision: click "Putuskan" to
  // reveal the Setujui/Tolak buttons + an optional note field, then
  // click "Setujui". Previous versions of the UI showed the buttons
  // inline — the disclosure was added later and the test never caught up.
  await supRow.getByRole('button', { name: 'Putuskan', exact: true }).click();
  await supRow.getByRole('button', { name: 'Setujui', exact: true }).click();

  await expect(supRow).not.toBeVisible({ timeout: 10_000 });

  // ---- Step 3: Employee sees APPROVED ------------------------------------
  await employeePage.reload();
  const employeeRow = employeePage
    .locator('li, article, div', { hasText: `Release deadline — ${runId}` })
    .first();
  await expect(employeeRow).toContainText(/Disetujui|APPROVED/i, { timeout: 10_000 });

  await employeeCtx.close();
  await supervisorCtx.close();
});
