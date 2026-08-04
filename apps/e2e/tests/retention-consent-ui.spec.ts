import { expect, test } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';

/**
 * Fase 31c — UI coverage for retention + consent surfaces.
 *
 * Three flows exercised here:
 *
 *   1. HR edits the tenant retention policy at
 *      `/admin/privacy/retention` — form loads existing values,
 *      accepts an update, shows "Perubahan tersimpan".
 *   2. HR publishes a new policy version at
 *      `/admin/privacy/policies` — appears in the versions list.
 *   3. Employee is force-routed to `/consent` after a new policy
 *      is published; accepting clears the gate.
 *
 * We use `SEED_USERS.hr` for admin flows and `SEED_USERS.employee`
 * for the consent gate. All state is reset between tests via the
 * `test-support/consent/prune` endpoint.
 */

test.describe.configure({ mode: 'serial' });

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

async function pruneConsent(email: string): Promise<void> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    await ctx
      .post('/api/v1/test-support/consent/prune', { data: { email } })
      .catch(() => undefined);
  } finally {
    await ctx.dispose();
  }
}

async function loginViaUi(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/kata sandi|password/i).fill(password);
  await page.getByRole('button', { name: /masuk|login/i }).click();
  // A pending policy forces `/consent`; the default landing is
  // `/attendance`. Accept either as "logged in".
  await page.waitForURL(
    (url) => !url.pathname.startsWith('/login') && !url.pathname.startsWith('/change-password'),
  );
}

test.beforeAll(async () => {
  for (const u of [SEED_USERS.employee.email, SEED_USERS.hr.email, SEED_USERS.admin.email]) {
    await pruneConsent(u);
  }
});

test('HR edits the tenant retention policy through /admin/privacy/retention', async ({ page }) => {
  await pruneConsent(SEED_USERS.hr.email);
  await loginViaUi(page, SEED_USERS.hr.email, SEED_USERS.hr.password);
  await page.goto('/admin/privacy/retention');

  const notifField = page.getByLabel(/retensi notifikasi/i);
  await expect(notifField).toBeVisible();

  // Pick a non-default value the test can verify was persisted.
  await notifField.fill('45');

  const submit = page.getByRole('button', { name: /simpan kebijakan/i });
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByText(/perubahan tersimpan/i)).toBeVisible({
    timeout: 5_000,
  });

  // Reloading the page should show the same value — proves the write hit the API.
  await page.reload();
  await expect(page.getByLabel(/retensi notifikasi/i)).toHaveValue('45');
});

test('HR publishes a new privacy policy version through /admin/privacy/policies', async ({
  page,
}) => {
  await pruneConsent(SEED_USERS.hr.email);
  await loginViaUi(page, SEED_USERS.hr.email, SEED_USERS.hr.password);
  await page.goto('/admin/privacy/policies');

  await page.getByRole('button', { name: /terbitkan versi baru/i }).click();

  const version = `ui-${Date.now()}`;
  await page.getByLabel(/label versi/i).fill(version);
  await page.getByLabel(/^judul$/i).fill('Kebijakan UI');
  await page.getByLabel(/isi kebijakan/i).fill('Isi kebijakan untuk UI test.');
  await page.getByRole('button', { name: /^terbitkan$/i }).click();

  // Form modal closes on success; the panel's list-refetch will then
  // fail with `CONSENT_REQUIRED` because HR themselves now need to
  // accept the version they just published (that's the intended
  // security invariant). Verify the row landed in the DB instead of
  // asserting on a stale UI list.
  await expect(page.getByRole('button', { name: /terbitkan versi baru/i })).toBeVisible({
    timeout: 5_000,
  });

  const { request } = await import('@playwright/test');
  const apiCtx = await request.newContext({ baseURL: API_URL });
  const loginRes = await apiCtx.post('/api/v1/auth/login', {
    data: { email: SEED_USERS.hr.email, password: SEED_USERS.hr.password },
  });
  const { accessToken } = (await loginRes.json()) as { accessToken: string };
  const listRes = await apiCtx.get('/api/v1/admin/privacy/policies', {
    headers: { Authorization: `Bearer ${accessToken}` },
    // A fresh session hasn't been to /auth/me yet so `pendingConsent`
    // is still latent — the guard fires on the read. Accept the just-
    // published version first via the tenant list to unblock the read.
    // Simpler: hit `/me/consent/current`, get its id, POST /me/consent.
  });
  // If the guard fires, unlock by accepting the current active policy.
  if (listRes.status() === 403) {
    const currRes = await apiCtx.get('/api/v1/me/consent/current', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const curr = (await currRes.json()) as { id: string };
    await apiCtx.post('/api/v1/me/consent', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { policyId: curr.id },
    });
  }
  const finalRes = await apiCtx.get('/api/v1/admin/privacy/policies', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(finalRes.status()).toBe(200);
  const listBody = (await finalRes.json()) as {
    items: Array<{ version: string }>;
  };
  expect(listBody.items.some((p) => p.version === version)).toBe(true);
  await apiCtx.dispose();

  await pruneConsent(SEED_USERS.hr.email);
});

test('employee is force-routed to /consent when a new policy is pending', async ({ page }) => {
  const version = `ui-emp-${Date.now()}`;

  // Publish a policy via the HR API so the employee's next login
  // surfaces `pendingConsent`. Using the HTTP path keeps the test
  // fast — no need to walk through the HR admin UI.
  const { request } = await import('@playwright/test');
  const apiCtx = await request.newContext({ baseURL: API_URL });
  const loginRes = await apiCtx.post('/api/v1/auth/login', {
    data: { email: SEED_USERS.hr.email, password: SEED_USERS.hr.password },
  });
  const { accessToken } = (await loginRes.json()) as { accessToken: string };
  await apiCtx.post('/api/v1/admin/privacy/policies', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { version, title: 'Kebijakan Wajib', body: 'Konten kebijakan.' },
  });
  await apiCtx.dispose();

  await loginViaUi(page, SEED_USERS.employee.email, SEED_USERS.employee.password);
  await expect(page).toHaveURL(/\/consent$/, { timeout: 5_000 });
  await expect(page.getByText(/kebijakan wajib/i)).toBeVisible();

  // Ticking the checkbox enables the CTA, clicking it walks the
  // user back into the app.
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /terima & lanjutkan/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/consent'));

  // The consent history panel now shows the just-accepted version.
  // Use exact match — the same version label also appears inside the
  // details summary, so a loose `getByText` would match twice and
  // Playwright's strict mode would reject.
  await page.goto('/settings/privacy');
  await expect(page.getByText(`v${version}`, { exact: true }).first()).toBeVisible({
    timeout: 5_000,
  });
});

test.afterAll(async () => {
  for (const u of [SEED_USERS.employee.email, SEED_USERS.hr.email, SEED_USERS.admin.email]) {
    await pruneConsent(u);
  }
});
