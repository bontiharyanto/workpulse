import { expect, test } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';

/**
 * Fase 31b — UI coverage for the right-to-erasure panels.
 *
 * We split into two flows:
 *
 *   1. Employee page (`/settings/privacy`) — two-step confirmation
 *      + submit + row appears with `PENDING_APPROVAL`.
 *   2. Admin page (`/admin/privacy/erasure-requests`) — approve
 *      moves the request off the "pending" tab; reject requires a
 *      note and surfaces it back on the row.
 *
 * We use `SEED_USERS.supervisor` for the self-service surface
 * because that user is never destroyed by the API spec — keeps
 * the UI suite runnable independent of run order.
 */

test.describe.configure({ mode: 'serial' });

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

async function pruneErasures(emails: string[]): Promise<void> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    for (const email of emails) {
      await ctx
        .post('/api/v1/test-support/data-erasure/prune', {
          data: { email },
        })
        .catch(() => undefined);
    }
  } finally {
    await ctx.dispose();
  }
}

test.beforeAll(async () => {
  await pruneErasures([
    SEED_USERS.supervisor.email,
    SEED_USERS.hr.email,
  ]);
});

async function loginViaUi(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/kata sandi|password/i).fill(password);
  await page.getByRole('button', { name: /masuk|login/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test('employee submits an erasure request through the /settings/privacy panel', async ({
  page,
}) => {
  await pruneErasures([SEED_USERS.supervisor.email]);

  await loginViaUi(
    page,
    SEED_USERS.supervisor.email,
    SEED_USERS.supervisor.password,
  );
  await page.goto('/settings/privacy');

  const panel = page.getByTestId('data-erasure-panel');
  await expect(panel).toBeVisible();

  // Submit disabled until BOTH the checkbox is on AND `HAPUS` typed.
  const submit = panel.getByTestId('erasure-submit');
  await expect(submit).toBeDisabled();

  await panel.getByTestId('erasure-reason').fill('test e2e');
  await panel.getByTestId('erasure-ack').check();
  await expect(submit).toBeDisabled();
  await panel.getByTestId('erasure-confirm').fill('HAPUS');
  await expect(submit).toBeEnabled();

  await submit.click();

  const row = panel.getByTestId('erasure-row').first();
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-status', 'PENDING_APPROVAL');
  await expect(row).toContainText(/Menunggu keputusan HR/i);

  // Once a request is in flight the submit button flips to
  // "Permintaan aktif berjalan" and stays disabled.
  await expect(submit).toBeDisabled();
});

test('HR approves the request via the admin queue', async ({ page }) => {
  await loginViaUi(page, SEED_USERS.hr.email, SEED_USERS.hr.password);
  await page.goto('/admin/privacy/erasure-requests');

  const panel = page.getByTestId('erasure-admin-panel');
  await expect(panel).toBeVisible();

  const row = panel.getByTestId('erasure-admin-row').first();
  await expect(row).toBeVisible();
  await expect(row).toContainText(SEED_USERS.supervisor.email);

  await row.getByTestId('erasure-approve').click();

  // Row disappears from the "Antrian" filter (default) because the
  // service also returns APPROVED_SCHEDULED there — assert the
  // status pill flips instead.
  await expect(panel.getByTestId('erasure-admin-row').first()).toHaveAttribute(
    'data-status',
    'APPROVED_SCHEDULED',
  );
});

test('user can cancel the scheduled erasure from /settings/privacy', async ({
  page,
}) => {
  await loginViaUi(
    page,
    SEED_USERS.supervisor.email,
    SEED_USERS.supervisor.password,
  );
  await page.goto('/settings/privacy');

  const panel = page.getByTestId('data-erasure-panel');
  const row = panel.getByTestId('erasure-row').first();
  await expect(row).toHaveAttribute('data-status', 'APPROVED_SCHEDULED');

  await row.getByTestId('erasure-cancel').click();
  await expect(
    panel.getByTestId('erasure-row').first(),
  ).toHaveAttribute('data-status', 'CANCELLED');
});
