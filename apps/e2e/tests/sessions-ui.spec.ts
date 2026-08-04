import { expect, request, test } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';
import { loginAs } from './helpers/login';

/**
 * Fase 30b — Sessions UI flows.
 *
 * The API surface is covered by `sessions.spec.ts`. This suite drives
 * the browser at `/settings/security`, asserting the FE contract:
 * multiple concurrent sessions render, the current one is badged,
 * a foreign session can be revoked, and "revoke others" leaves the
 * current tab alive.
 *
 * We serialize because every test mutates the same seed user's
 * `RefreshToken` table.
 */
test.describe.configure({ mode: 'serial' });

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

/**
 * Create a secondary session for `role` by hitting `/auth/login` from
 * a fresh APIRequestContext. The context is disposed after the test
 * (its cookie is never used again) — the row on the server survives
 * until either the token expires or a UI revoke burns it.
 */
async function forkExtraSession(
  role: keyof typeof SEED_USERS,
  userAgent: string,
): Promise<void> {
  const ctx = await request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { 'user-agent': userAgent },
  });
  try {
    const user = SEED_USERS[role];
    const res = await ctx.post('/api/v1/auth/login', {
      data: { email: user.email, password: user.password },
    });
    if (!res.ok()) {
      throw new Error(
        `forkExtraSession(${role}) failed: ${res.status()} ${await res.text()}`,
      );
    }
  } finally {
    await ctx.dispose();
  }
}

/**
 * Reset a seed user to a "one session only" baseline. Login, revoke
 * every other session, dispose. This is essential in a serial suite
 * where every test leaves behind residual `RefreshToken` rows that
 * would otherwise skew the next test's row counts.
 */
async function pruneToOneSession(
  role: keyof typeof SEED_USERS,
): Promise<void> {
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    const user = SEED_USERS[role];
    const login = await ctx.post('/api/v1/auth/login', {
      data: { email: user.email, password: user.password },
    });
    if (!login.ok()) return;
    const body = (await login.json()) as { accessToken: string };
    await ctx.post('/api/v1/auth/sessions/revoke-others', {
      headers: { Authorization: `Bearer ${body.accessToken}` },
    });
    // Now revoke this scratch session too — otherwise the next test's
    // `loginAs` sees a leftover session and off-by-one strikes.
    const listRes = await ctx.get('/api/v1/auth/sessions', {
      headers: { Authorization: `Bearer ${body.accessToken}` },
    });
    if (listRes.ok()) {
      const list = (await listRes.json()) as {
        sessions: Array<{ id: string; isCurrent: boolean }>;
      };
      const own = list.sessions.find((r) => r.isCurrent);
      if (own) {
        await ctx.delete(`/api/v1/auth/sessions/${own.id}`, {
          headers: { Authorization: `Bearer ${body.accessToken}` },
        });
      }
    }
  } finally {
    await ctx.dispose();
  }
}

test.beforeEach(async () => {
  await pruneToOneSession('employee');
});

test('SessionsPanel renders every active session and marks the current one', async ({
  page,
}) => {
  await forkExtraSession('employee', 'e2e-agent/ui-list-1');
  await forkExtraSession('employee', 'e2e-agent/ui-list-2');
  await loginAs(page, 'employee');
  await page.goto('/settings/security');

  await expect(
    page.getByRole('heading', { name: 'Sesi aktif', exact: true }),
  ).toBeVisible();

  const panel = page.getByTestId('sessions-panel');
  await expect(panel).toBeVisible();
  const rows = panel.getByTestId('session-row');
  await expect(rows).toHaveCount(3, { timeout: 10_000 });

  const current = panel.locator('[data-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText(/Sesi ini/i);
});

test('Revoking a foreign session removes it from the list without logging the current tab out', async ({
  page,
}) => {
  await forkExtraSession('employee', 'e2e-agent/kill-me-ui');
  await loginAs(page, 'employee');
  await page.goto('/settings/security');
  const panel = page.getByTestId('sessions-panel');

  // Wait until at least two rows are listed (the current tab + at
  // least one forked session).
  await expect(panel.getByTestId('session-row')).toHaveCount(2, {
    timeout: 10_000,
  });

  const foreign = panel
    .locator('[data-testid="session-row"]:not([data-current])')
    .first();
  await expect(foreign).toBeVisible();
  await foreign.getByTestId('session-revoke-btn').click();
  await foreign.getByTestId('session-revoke-confirm').click();

  await expect(panel.getByTestId('session-row')).toHaveCount(1, {
    timeout: 10_000,
  });
  // The remaining row IS the current one.
  await expect(
    panel.locator('[data-current="true"]'),
  ).toHaveCount(1);

  // The dashboard shell is still reachable (we did not accidentally
  // revoke ourselves).
  await page.goto('/attendance');
  await expect(page).not.toHaveURL(/\/login/);
});

test('"Logout semua sesi lain" leaves the current tab alive and reports the count', async ({
  page,
}) => {
  await forkExtraSession('employee', 'e2e-agent/sweep-1');
  await forkExtraSession('employee', 'e2e-agent/sweep-2');
  await forkExtraSession('employee', 'e2e-agent/sweep-3');
  await loginAs(page, 'employee');
  await page.goto('/settings/security');
  const panel = page.getByTestId('sessions-panel');

  await expect(panel.getByTestId('session-row')).toHaveCount(4, {
    timeout: 10_000,
  });

  await panel.getByTestId('sessions-revoke-others').click();

  // Success toast tells us the count.
  await expect(
    page.getByRole('status').filter({ hasText: /sesi lain berhasil dinonaktifkan/i }),
  ).toBeVisible({ timeout: 10_000 });

  // Only the current session remains.
  await expect(panel.getByTestId('session-row')).toHaveCount(1);
  await expect(panel.locator('[data-current="true"]')).toHaveCount(1);

  // Button is now disabled because there is nothing else to revoke.
  await expect(panel.getByTestId('sessions-revoke-others')).toBeDisabled();
});
