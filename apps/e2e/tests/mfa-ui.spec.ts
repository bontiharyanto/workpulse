import { expect, test, type Page } from '@playwright/test';

import { loginAs } from './helpers/login';
import { disableMfaViaApi, enrollMfaViaApi, generateTotp } from './helpers/mfa';
import { SEED_USERS } from './fixtures/users';

/**
 * Fase 30a — MFA UI flows.
 *
 * The API surface is exercised by `mfa.spec.ts`. This suite drives the
 * browser instead: it asserts the FE contract for enrollment,
 * login-with-MFA, and disable.
 *
 * The tests share a single seed account (`employee`) whose persistent
 * `mfaEnabled` flag is mutated end-to-end, so we serialize the file
 * and each test performs a best-effort cleanup afterwards via the
 * API. That keeps flake surface small: if a UI assertion trips mid
 * enrollment, the very next test can still start from a known
 * "not enrolled" baseline.
 */
test.describe.configure({ mode: 'serial' });

/**
 * Track the secret used by the most recent enrollment so `afterEach`
 * can always disable MFA cleanly. When a test never enrols, the value
 * stays `null` and `afterEach` becomes a no-op.
 */
let activeSecret: string | null = null;

test.afterEach(async () => {
  if (activeSecret) {
    await disableMfaViaApi('employee', activeSecret);
    activeSecret = null;
  }
});

/**
 * Extract the base32 TOTP secret that the enrollment panel exposes
 * inside a `<details>` for manual entry. We open the disclosure
 * first because Playwright's `.textContent()` returns the closed
 * markup as well, so no need to force visibility.
 */
async function readEnrollmentSecret(page: Page): Promise<string> {
  const details = page.getByText(/Tidak bisa scan\? Ketik secret manual\./i);
  await details.click();
  const secretEl = page.locator('details p.select-all').first();
  await expect(secretEl).toBeVisible();
  const secret = (await secretEl.textContent())?.trim() ?? '';
  expect(secret).toMatch(/^[A-Z2-7]+$/);
  return secret;
}

test('MFA enroll UI: voluntary enrollment from /settings/security', async ({ page }) => {
  await loginAs(page, 'employee');
  await page.goto('/settings/security');

  await expect(page.getByRole('heading', { name: 'Keamanan akun' })).toBeVisible();

  // Status card renders "Nonaktif" for a fresh account.
  await expect(page.getByText('MFA belum diaktifkan')).toBeVisible();

  // Step 1 — start enrollment. The panel swaps to the QR + manual
  // secret view.
  await page.getByRole('button', { name: /Mulai aktifkan MFA/i }).click();
  await expect(page.getByRole('img', { name: /QR code untuk enrollment MFA/i })).toBeVisible();

  const secret = await readEnrollmentSecret(page);
  activeSecret = secret;

  // Step 2 — feed the current TOTP and submit.
  const totp = generateTotp(secret);
  await page.locator('#mfa-confirm-code').fill(totp);
  await page.getByRole('button', { name: /^Aktifkan MFA$/ }).click();

  // Backup codes are shown exactly once, in a monospaced grid of 8.
  await expect(page.getByText('Simpan backup codes berikut')).toBeVisible();
  const codeItems = page.locator('ul.grid.font-mono').first().locator('li');
  await expect(codeItems).toHaveCount(8);

  // Acknowledge and confirm the status card flips to Aktif.
  await page.getByRole('button', { name: /Saya sudah menyimpannya/i }).click();
  await expect(page.getByText(/^Aktif$/).first()).toBeVisible();
  await expect(page.getByText(/8 backup codes tersisa/)).toBeVisible();
});

test('MFA login UI: password login redirects to /login/mfa, TOTP unlocks the dashboard', async ({
  page,
}) => {
  const { secret } = await enrollMfaViaApi('employee');
  activeSecret = secret;

  const employee = SEED_USERS.employee;

  await page.goto('/login');
  await page.locator('#email').fill(employee.email);
  await page.locator('#password').fill(employee.password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();

  // We land on the MFA verify step (title copy is stable enough to
  // assert against).
  await page.waitForURL(/\/login\/mfa/, { timeout: 10_000 });
  await expect(page.getByRole('heading', { name: /Verifikasi 2 langkah/i })).toBeVisible();

  // Wrong code first → the API mapper surfaces "Kode MFA tidak valid.".
  await page.locator('#code').fill('000000');
  await page.getByRole('button', { name: /^Verifikasi$/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Kode MFA tidak valid/i })).toBeVisible();

  // Retry with the real TOTP → we get bounced to /attendance.
  await page.locator('#code').fill(generateTotp(secret));
  await page.getByRole('button', { name: /^Verifikasi$/ }).click();
  await page.waitForURL(/\/attendance/, { timeout: 10_000 });
  await expect(page).not.toHaveURL(/\/login/);
});

test('MFA login UI: backup code path also unlocks the dashboard', async ({ page }) => {
  const { secret, backupCodes } = await enrollMfaViaApi('employee');
  activeSecret = secret;

  const employee = SEED_USERS.employee;
  await page.goto('/login');
  await page.locator('#email').fill(employee.email);
  await page.locator('#password').fill(employee.password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();

  await page.waitForURL(/\/login\/mfa/, { timeout: 10_000 });

  // Switch to "Backup code" mode.
  await page.getByRole('button', { name: 'Backup code', exact: true }).click();
  const backup = backupCodes[0];
  expect(backup).toBeTruthy();
  await page.locator('#backupCode').fill(backup as string);
  await page.getByRole('button', { name: /^Verifikasi$/ }).click();

  await page.waitForURL(/\/attendance/, { timeout: 10_000 });
  await expect(page).not.toHaveURL(/\/login/);
});

test('MFA disable UI: rejects wrong password, accepts correct pair, logs out to /login', async ({
  page,
}) => {
  const { secret } = await enrollMfaViaApi('employee');
  activeSecret = secret;

  const employee = SEED_USERS.employee;

  // Full login (password + TOTP) via UI so we end up on the dashboard.
  await page.goto('/login');
  await page.locator('#email').fill(employee.email);
  await page.locator('#password').fill(employee.password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await page.waitForURL(/\/login\/mfa/);
  await page.locator('#code').fill(generateTotp(secret));
  await page.getByRole('button', { name: /^Verifikasi$/ }).click();
  await page.waitForURL(/\/attendance/);

  await page.goto('/settings/security');
  await expect(page.getByRole('heading', { name: 'Nonaktifkan MFA' })).toBeVisible();

  // Wrong password → surfaces "Password tidak sesuai."
  await page.locator('#disable-pw').fill('definitely-not-my-password');
  await page.locator('#disable-code').fill(generateTotp(secret));
  await page.getByRole('button', { name: /^Nonaktifkan MFA$/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Password tidak sesuai/i })).toBeVisible();

  // Correct pair → the panel forces a full logout (see the
  // `authStore.clear()` + `window.location.assign('/login')` in
  // `MfaManagementPanel`).
  await page.locator('#disable-pw').fill(employee.password);
  await page.locator('#disable-code').fill(generateTotp(secret));
  await page.getByRole('button', { name: /^Nonaktifkan MFA$/ }).click();
  await page.waitForURL(/\/login/, { timeout: 10_000 });

  // Log back in — no MFA step this time.
  await page.locator('#email').fill(employee.email);
  await page.locator('#password').fill(employee.password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await page.waitForURL(/\/(attendance|leave|overtime|admin)/, { timeout: 10_000 });

  // Status card back to Nonaktif.
  await page.goto('/settings/security');
  await expect(page.getByText(/^Nonaktif$/).first()).toBeVisible();
  await expect(page.getByText('MFA belum diaktifkan')).toBeVisible();

  // MFA already disabled — no cleanup needed. Prevent afterEach from
  // touching the account.
  activeSecret = null;
});

test('MFA regenerate backup codes UI: reveals a fresh batch', async ({ page }) => {
  const { secret, backupCodes: originalCodes } = await enrollMfaViaApi('employee');
  activeSecret = secret;

  const employee = SEED_USERS.employee;
  await page.goto('/login');
  await page.locator('#email').fill(employee.email);
  await page.locator('#password').fill(employee.password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await page.waitForURL(/\/login\/mfa/);
  await page.locator('#code').fill(generateTotp(secret));
  await page.getByRole('button', { name: /^Verifikasi$/ }).click();
  await page.waitForURL(/\/attendance/);

  await page.goto('/settings/security');
  await expect(page.getByRole('heading', { name: 'Regenerasi backup codes' })).toBeVisible();

  await page.getByLabel(/Kode TOTP untuk regenerasi backup codes/i).fill(generateTotp(secret));
  await page.getByRole('button', { name: /^Regenerasi$/ }).click();

  await expect(page.getByText('Simpan backup codes berikut')).toBeVisible();
  const codeItems = page.locator('ul.grid.font-mono').first().locator('li');
  await expect(codeItems).toHaveCount(8);

  const rendered = await codeItems.allTextContents();
  const overlap = rendered.filter((c) => originalCodes.includes(c.trim()));
  expect(overlap).toHaveLength(0);
});
