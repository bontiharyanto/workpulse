import { expect, request, test } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';
import { loginAs } from './helpers/login';

/**
 * Fase 31a — DSAR / privacy UI flow.
 *
 * The API surface is covered by `data-export.spec.ts`. This suite
 * drives the browser at `/settings/privacy`, asserting the FE
 * contract:
 *
 *   1. The panel renders and shows an empty state when the user has
 *      no history.
 *   2. Clicking the "Ajukan ekspor data" button creates a PENDING
 *      row that surfaces in the list.
 *   3. Polling flips the row to READY once the worker completes
 *      (within the 30-second cron window).
 *   4. The "Unduh" button triggers a navigation to the presigned S3
 *      URL — we intercept the navigation and assert the target is
 *      the MinIO endpoint.
 *
 * Serial mode is required — every test mutates the same seed user's
 * `DataExportRequest` table and the service-layer 24h cooldown will
 * bite a second "create" test unless the previous rows are pruned
 * out first.
 */
test.describe.configure({ mode: 'serial' });

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const WORKER_MAX_WAIT_MS = 90_000; // 3 ticks of the 30s cron

/**
 * Wipe every `DataExportRequest` row for the given seed user via an
 * escape hatch. There is no admin endpoint for this (by design —
 * see `data-export.controller.ts`), so we call Prisma directly
 * through a small helper API route. If that route doesn't exist,
 * we fall back to sleeping past the cooldown window, which is
 * unacceptable in CI. So instead we use raw SQL via an untyped
 * fetch to a per-test helper mounted only in NODE_ENV!=production
 * (see `apps/api/src/test-support/*`).
 *
 * If the helper route isn't wired, we fall back to skipping the
 * "second-create-after-first-completes" case — the API spec covers
 * that path with the same worker anyway.
 */
async function tryPruneExportsFor(email: string): Promise<boolean> {
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    const res = await ctx.post('/api/v1/test-support/data-export/prune', {
      data: { email },
    });
    return res.ok();
  } catch {
    return false;
  } finally {
    await ctx.dispose();
  }
}

test('Empty state renders when the user has never requested an export', async ({
  page,
}) => {
  await tryPruneExportsFor(SEED_USERS.employee.email);
  await loginAs(page, 'employee');
  await page.goto('/settings/privacy');

  const panel = page.getByTestId('data-export-panel');
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole('heading', { name: 'Ekspor data pribadi' }),
  ).toBeVisible();
  await expect(
    panel.getByText(/Belum ada permintaan ekspor/i),
  ).toBeVisible();
  await expect(panel.getByTestId('data-export-create')).toBeEnabled();
});

test('Click "Ajukan ekspor data" → PENDING row appears; polling flips it to READY; download button fires', async ({
  page,
}) => {
  await tryPruneExportsFor(SEED_USERS.employee.email);
  await loginAs(page, 'employee');
  await page.goto('/settings/privacy');

  const panel = page.getByTestId('data-export-panel');
  await panel.getByTestId('data-export-create').click();

  // Row appears with PENDING or PROCESSING status.
  const rows = panel.getByTestId('data-export-row');
  await expect(rows).toHaveCount(1, { timeout: 10_000 });
  const row = rows.first();
  await expect(row).toHaveAttribute('data-status', /PENDING|PROCESSING/);

  // Wait until the worker flips the row to READY.
  await expect(row).toHaveAttribute('data-status', 'READY', {
    timeout: WORKER_MAX_WAIT_MS,
  });

  // Download button surfaces only on READY rows.
  const downloadBtn = row.getByTestId('data-export-download');
  await expect(downloadBtn).toBeVisible();

  // Intercept the navigation to assert we're being redirected to
  // the S3 presigned URL — we can't actually download the ZIP
  // because MinIO's response redirects out of the browser context.
  const navPromise = page.waitForRequest(
    (req) => /localhost:9000\/workpulse\/data-exports\//.test(req.url()),
    { timeout: 15_000 },
  );
  await downloadBtn.click();
  const navRequest = await navPromise;
  expect(navRequest.url()).toContain('X-Amz-Signature=');
});

test('Clicking create while cooldown is active surfaces the EXPORT_COOLDOWN copy', async ({
  page,
}) => {
  // Do NOT prune — reuse the row from the previous test so the
  // 24h cooldown is active. The FE POSTs on click and expects a
  // 409 to bubble up as an inline error message.
  await loginAs(page, 'employee');
  await page.goto('/settings/privacy');

  const panel = page.getByTestId('data-export-panel');
  await expect(panel.getByTestId('data-export-row')).toHaveCount(1, {
    timeout: 10_000,
  });

  await panel.getByTestId('data-export-create').click();

  await expect(
    panel.getByRole('alert').filter({ hasText: /sekali per 24 jam/i }),
  ).toBeVisible({ timeout: 10_000 });
});
