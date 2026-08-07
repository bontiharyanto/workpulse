import { expect, test } from '@playwright/test';

import { daysFromToday } from './helpers/dates';
import { loginAs } from './helpers/login';

/**
 * Full multi-role leave flow — the single most business-critical path in
 * Workpulse.
 *
 * We intentionally don't split this into three tests (one per role) because
 * the assertions are stateful: the supervisor must see something the
 * employee just submitted, and the HR must see something the supervisor
 * just approved. A single ordered test keeps the coupling explicit rather
 * than relying on `test.describe.serial` ordering and hidden shared state.
 *
 * The reason string embeds a unique run id (timestamp) so re-runs against
 * the same DB never collide with earlier requests still hanging around in
 * pending states.
 */
test.describe.configure({ mode: 'serial' });

test('leave: employee submits → supervisor approves → HR approves', async ({ browser }) => {
  const runId = `e2e-${Date.now()}`;
  const startDate = daysFromToday(7);
  const endDate = daysFromToday(8);

  // ---- Step 1: Employee submits ------------------------------------------
  const employeeCtx = await browser.newContext();
  const employeePage = await employeeCtx.newPage();

  await loginAs(employeePage, 'employee');
  await employeePage.goto('/leave');

  // Leave-type select is a Radix `Select` (shadcn) whose trigger carries
  // `id="leaveTypeId"` but is NOT a native `<select>`. Opening it lazily
  // mounts a Radix portal with `role="listbox"` and `role="option"`
  // children. Wait for the trigger to be enabled (types finish loading)
  // then click through the portal.
  const typeTrigger = employeePage.locator('#leaveTypeId');
  await expect(typeTrigger).toBeEnabled({ timeout: 10_000 });
  await typeTrigger.click();
  await employeePage
    .getByRole('option', { name: /Annual Leave/i })
    .first()
    .click();

  await employeePage.locator('#startDate').fill(startDate);
  await employeePage.locator('#endDate').fill(endDate);
  await employeePage.locator('#reason').fill(`Family event — ${runId}`);

  await employeePage.getByRole('button', { name: /^Ajukan cuti$/ }).click();

  // The employee's own list should now render the fresh row in a
  // pending-supervisor state.
  await expect(employeePage.getByText(`Family event — ${runId}`, { exact: false })).toBeVisible({
    timeout: 10_000,
  });

  // ---- Step 2: Supervisor approves ---------------------------------------
  const supervisorCtx = await browser.newContext();
  const supervisorPage = await supervisorCtx.newPage();

  await loginAs(supervisorPage, 'supervisor');
  await supervisorPage.goto('/leave/approvals');

  // Locate the row belonging to this run and click its Approve button.
  // The approval list renders each request as a `<Card>` tagged with
  // `data-testid="leave-approval-row"`.
  const supRow = supervisorPage
    .getByTestId('leave-approval-row')
    .filter({ hasText: `Family event — ${runId}` })
    .first();
  await expect(supRow).toBeVisible({ timeout: 10_000 });
  await supRow.getByRole('button', { name: 'Setujui', exact: true }).click();

  // The row should disappear from the supervisor's pending queue (it moves
  // to PENDING_HR, which the supervisor cannot decide on).
  await expect(supRow).not.toBeVisible({ timeout: 10_000 });

  // ---- Step 3: HR approves -----------------------------------------------
  const hrCtx = await browser.newContext();
  const hrPage = await hrCtx.newPage();

  await loginAs(hrPage, 'hr');
  await hrPage.goto('/leave/approvals');

  const hrRow = hrPage
    .getByTestId('leave-approval-row')
    .filter({ hasText: `Family event — ${runId}` })
    .first();
  await expect(hrRow).toBeVisible({ timeout: 10_000 });
  await hrRow.getByRole('button', { name: 'Setujui', exact: true }).click();
  await expect(hrRow).not.toBeVisible({ timeout: 10_000 });

  // ---- Step 4: Employee sees APPROVED ------------------------------------
  await employeePage.reload();
  const employeeRow = employeePage
    .locator('li, div', { hasText: `Family event — ${runId}` })
    .first();
  await expect(employeeRow).toContainText('Disetujui', { timeout: 10_000 });

  await employeeCtx.close();
  await supervisorCtx.close();
  await hrCtx.close();
});
