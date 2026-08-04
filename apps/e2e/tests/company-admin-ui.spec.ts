import { expect, test } from '@playwright/test';

import { loginAs } from './helpers/login';

/**
 * Fase 29b — SUPER_ADMIN Company Admin UI.
 *
 * The API surface is exercised by `company-admin.spec.ts` — this suite
 * asserts the FE contract: the /admin/companies route exists, is gated
 * to SUPER_ADMIN, and drives the underlying `companiesAdminApi` end to
 * end (create → temp-password reveal → edit → guarded soft-delete).
 *
 * We serialize the tests because the "Tenant" tab is a single global
 * resource and the create flow leaves rows in the shared DB — running
 * in parallel risks slug collisions and dirty pagination.
 */
test.describe.configure({ mode: 'serial' });

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

test('SUPER_ADMIN: create → reveal → edit → guarded delete flow', async ({ page }) => {
  await loginAs(page, 'admin');

  // ---- Nav to /admin/companies via the subnav ---------------------------
  await page.goto('/admin/users');
  const tenantTab = page.getByRole('link', { name: 'Tenant', exact: true });
  await expect(tenantTab).toBeVisible();
  await tenantTab.click();
  await page.waitForURL(/\/admin\/companies/);
  await expect(page.getByRole('heading', { name: 'Tenant', exact: true })).toBeVisible();

  // ---- Open create panel ------------------------------------------------
  await page.getByTestId('add-company-btn').click();
  await expect(page.getByTestId('company-create-panel')).toBeVisible();

  const suffix = uniqueSuffix();
  const name = `UI Tenant ${suffix}`;
  const hrEmail = `ui-hr-${suffix}@e2e.test`;

  await page.getByTestId('company-name-input').fill(name);
  await page.getByTestId('hr-fullname-input').fill('UI Bootstrap HR');
  await page.getByTestId('hr-email-input').fill(hrEmail);
  await page.getByTestId('company-timezone-select').selectOption('Asia/Jakarta');

  await page.getByTestId('company-submit-btn').click();

  // ---- CredentialReveal appears (one-time temp password) ----------------
  const reveal = page.getByRole('alertdialog');
  await expect(reveal).toBeVisible();
  await expect(reveal).toContainText(hrEmail);
  await expect(reveal).toContainText(new RegExp(name));
  // Password is masked by default — clicking "Tampilkan" reveals it.
  await reveal.getByRole('button', { name: 'Tampilkan' }).click();
  await reveal.getByRole('button', { name: 'Saya sudah mencatat, tutup' }).click();
  await expect(reveal).toBeHidden();

  // ---- New tenant is present in the list --------------------------------
  const table = page.getByTestId('company-table');
  await expect(table).toContainText(name);

  // Locate the row's edit button by its data-testid pattern (slug-derived).
  // The API auto-derives slug from the name; we don't know the exact
  // value, so we look up by the visible name and act on that row.
  const row = table.locator('tr').filter({ hasText: name }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('Aktif');
  await expect(row).toContainText('Asia/Jakarta');
  await expect(row).toContainText('1'); // userCount — the bootstrap HR user

  // ---- Edit the tenant --------------------------------------------------
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  const editPanel = page.getByTestId('company-edit-panel');
  await expect(editPanel).toBeVisible();

  const renamed = `${name} Renamed`;
  const nameInput = editPanel.getByRole('textbox').first();
  await nameInput.fill(renamed);
  await editPanel.getByRole('button', { name: /Simpan perubahan/i }).click();
  await expect(editPanel).toBeHidden();
  await expect(table).toContainText(renamed);

  // ---- Guarded soft-delete (active HR user remains) ---------------------
  const renamedRow = table.locator('tr').filter({ hasText: renamed }).first();
  page.once('dialog', (dialog) => void dialog.accept());
  await renamedRow.getByRole('button', { name: 'Nonaktifkan', exact: true }).click();
  // The API refuses with COMPANY_HAS_ACTIVE_USERS → the UI surfaces the
  // mapped Indonesian copy.
  await expect(page.getByTestId('company-error')).toContainText(/karyawan aktif/i);
  // The row is still active (nothing was actually deleted).
  await expect(renamedRow).toContainText('Aktif');
});

test('SUPER_ADMIN: cannot soft-delete its own tenant (button disabled)', async ({ page }) => {
  await loginAs(page, 'admin');
  await page.goto('/admin/companies');
  await expect(page.getByRole('heading', { name: 'Tenant', exact: true })).toBeVisible();

  // The seeded SUPER_ADMIN belongs to the Acme tenant (see
  // `apps/api/prisma/seed.ts`). Locate that row and confirm the delete
  // button is disabled with the "Sendiri" badge visible.
  const table = page.getByTestId('company-table');
  const selfRow = table
    .locator('tr')
    .filter({ has: page.locator('text=Sendiri') })
    .first();
  await expect(selfRow).toBeVisible();
  const deleteBtn = selfRow.getByRole('button', { name: 'Nonaktifkan' });
  await expect(deleteBtn).toBeDisabled();
});

// ---------------------------------------------------------------------------
// RBAC — HR must not see or reach /admin/companies.
// ---------------------------------------------------------------------------

test('HR: the Tenant tab is NOT rendered in the admin subnav', async ({ page }) => {
  await loginAs(page, 'hr');
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Karyawan' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tenant', exact: true })).toHaveCount(0);
});

test('HR: direct navigation to /admin/companies renders an access-denied panel', async ({
  page,
}) => {
  await loginAs(page, 'hr');
  await page.goto('/admin/companies');
  // The <RequireRole> guard renders a role-alert with the standard copy.
  // Next.js's own `#__next-route-announcer__` is also `role="alert"`, so
  // we filter by the localized copy to disambiguate.
  await expect(page.getByRole('alert').filter({ hasText: /tidak memiliki akses/i })).toBeVisible();
  await expect(page.getByTestId('company-admin-root')).toHaveCount(0);
});
