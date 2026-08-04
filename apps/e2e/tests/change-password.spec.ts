import { expect, test } from '@playwright/test';

import { authenticateApi } from './helpers/api';

/**
 * Fase 27 — Reset Password Enforcement on Temp-Password Login.
 *
 * Covers the three properties the guard exists to enforce:
 *   1. A freshly-issued temp password DOES let the user log in, but
 *      every non-`/auth` endpoint returns 403 PASSWORD_CHANGE_REQUIRED
 *      until the password is rotated.
 *   2. `POST /auth/change-password` succeeds with the temp password,
 *      clears the flag, revokes every refresh token, and lets a fresh
 *      login pass through to protected endpoints.
 *   3. An admin-issued reset re-arms the flag: even a user who had
 *      previously self-picked a password is bounced back through
 *      /change-password on their next login.
 *
 * Each test provisions its own throwaway user via the User Admin API
 * so runs are hermetic and re-runnable without a DB reset.
 */

interface AdminCreateResponse {
  user: { id: string; email: string };
  temporaryPassword: string;
}

async function createTempUser(): Promise<AdminCreateResponse & { cleanup: () => Promise<void> }> {
  const admin = await authenticateApi('admin');
  const email = `e2e-change-pw-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.test`;
  const res = await admin.api.post('/api/v1/admin/users', {
    data: {
      email,
      fullName: 'E2E ChangePw',
      role: 'EMPLOYEE',
      hiredAt: '2026-01-01',
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = (await res.json()) as AdminCreateResponse;

  return {
    ...body,
    cleanup: async () => {
      await admin.api.delete(`/api/v1/admin/users/${body.user.id}`).catch(() => undefined);
      await admin.api.dispose();
    },
  };
}

test.describe('Fase 27 — change-password enforcement', () => {
  test('temp-password login returns mustChangePassword=true and blocks other endpoints', async ({
    request,
  }) => {
    const temp = await createTempUser();
    try {
      const loginRes = await request.post('http://localhost:4000/api/v1/auth/login', {
        data: { email: temp.user.email, password: temp.temporaryPassword },
      });
      expect(loginRes.ok()).toBeTruthy();
      const login = (await loginRes.json()) as {
        accessToken: string;
        user: { mustChangePassword: boolean };
      };
      expect(login.user.mustChangePassword).toBe(true);

      // /auth/me should still work — it's on the guard allowlist.
      const meRes = await request.get('http://localhost:4000/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${login.accessToken}` },
      });
      expect(meRes.ok()).toBeTruthy();

      // Any non-auth endpoint should be blocked with the sentinel code.
      const blockedRes = await request.get('http://localhost:4000/api/v1/leave/mine', {
        headers: { Authorization: `Bearer ${login.accessToken}` },
      });
      expect(blockedRes.status()).toBe(403);
      const body = (await blockedRes.json()) as { code: string };
      expect(body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    } finally {
      await temp.cleanup();
    }
  });

  test('change-password happy path clears flag and revokes all refresh tokens', async ({
    request,
  }) => {
    const temp = await createTempUser();
    try {
      const loginRes = await request.post('http://localhost:4000/api/v1/auth/login', {
        data: { email: temp.user.email, password: temp.temporaryPassword },
      });
      const { accessToken } = (await loginRes.json()) as { accessToken: string };

      const newPassword = `SelfPicked!${Date.now()}`;
      const changeRes = await request.post(
        'http://localhost:4000/api/v1/auth/change-password',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          data: {
            currentPassword: temp.temporaryPassword,
            newPassword,
          },
        },
      );
      expect(changeRes.ok(), await changeRes.text()).toBeTruthy();

      // Old refresh cookie was revoked → subsequent /auth/refresh fails.
      const staleRefresh = await request.post('http://localhost:4000/api/v1/auth/refresh');
      expect(staleRefresh.status()).toBe(401);

      // Old temp password no longer works.
      const oldPwLogin = await request.post('http://localhost:4000/api/v1/auth/login', {
        data: { email: temp.user.email, password: temp.temporaryPassword },
      });
      expect(oldPwLogin.status()).toBe(401);

      // New password lets the user through; flag is now cleared.
      const relogin = await request.post('http://localhost:4000/api/v1/auth/login', {
        data: { email: temp.user.email, password: newPassword },
      });
      expect(relogin.ok()).toBeTruthy();
      const reloginBody = (await relogin.json()) as {
        accessToken: string;
        user: { mustChangePassword: boolean };
      };
      expect(reloginBody.user.mustChangePassword).toBe(false);

      // Protected endpoint now succeeds.
      const leaveRes = await request.get('http://localhost:4000/api/v1/leave/mine', {
        headers: { Authorization: `Bearer ${reloginBody.accessToken}` },
      });
      expect(leaveRes.ok()).toBeTruthy();
    } finally {
      await temp.cleanup();
    }
  });

  test('change-password rejects wrong current password (INVALID_CREDENTIALS)', async ({
    request,
  }) => {
    const temp = await createTempUser();
    try {
      const loginRes = await request.post('http://localhost:4000/api/v1/auth/login', {
        data: { email: temp.user.email, password: temp.temporaryPassword },
      });
      const { accessToken } = (await loginRes.json()) as { accessToken: string };

      const res = await request.post(
        'http://localhost:4000/api/v1/auth/change-password',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          data: {
            currentPassword: 'definitely-not-my-password',
            newPassword: 'AnotherPass1!',
          },
        },
      );
      expect(res.status()).toBe(401);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('INVALID_CREDENTIALS');
    } finally {
      await temp.cleanup();
    }
  });

  test('admin reset re-arms mustChangePassword even after the user picked their own', async ({
    request,
  }) => {
    const temp = await createTempUser();
    try {
      // Step 1: user rotates temp → self-picked.
      const loginRes = await request.post('http://localhost:4000/api/v1/auth/login', {
        data: { email: temp.user.email, password: temp.temporaryPassword },
      });
      const { accessToken } = (await loginRes.json()) as { accessToken: string };

      const selfPicked = `MyOwn!${Date.now()}`;
      await request.post('http://localhost:4000/api/v1/auth/change-password', {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: { currentPassword: temp.temporaryPassword, newPassword: selfPicked },
      });

      // Confirm flag is now false.
      const midLogin = await request.post('http://localhost:4000/api/v1/auth/login', {
        data: { email: temp.user.email, password: selfPicked },
      });
      const midBody = (await midLogin.json()) as { user: { mustChangePassword: boolean } };
      expect(midBody.user.mustChangePassword).toBe(false);

      // Step 2: HR/admin issues a NEW reset. The response has a fresh
      // temp password and re-arms the flag server-side.
      const admin = await authenticateApi('admin');
      try {
        const resetRes = await admin.api.post(
          `/api/v1/admin/users/${temp.user.id}/reset-password`,
        );
        expect(resetRes.ok()).toBeTruthy();
        const resetBody = (await resetRes.json()) as { temporaryPassword: string };

        // Step 3: login with the new temp password — flag MUST be true again.
        const afterReset = await request.post('http://localhost:4000/api/v1/auth/login', {
          data: { email: temp.user.email, password: resetBody.temporaryPassword },
        });
        expect(afterReset.ok()).toBeTruthy();
        const afterBody = (await afterReset.json()) as {
          user: { mustChangePassword: boolean };
        };
        expect(afterBody.user.mustChangePassword).toBe(true);
      } finally {
        await admin.api.dispose();
      }
    } finally {
      await temp.cleanup();
    }
  });

  test('login UI redirects a temp-password caller to /change-password', async ({ page }) => {
    const temp = await createTempUser();
    try {
      await page.goto('/login');
      await page.locator('#email').fill(temp.user.email);
      await page.locator('#password').fill(temp.temporaryPassword);
      await page.getByRole('button', { name: 'Masuk', exact: true }).click();

      await page.waitForURL(/\/change-password/, { timeout: 10_000 });
      // The forced banner is displayed only when the flag is set.
      await expect(page.getByRole('status')).toContainText(/password sementara/i);
    } finally {
      await temp.cleanup();
    }
  });

  test('UI change-password success bounces to /login with a confirmation toast', async ({
    page,
    request,
  }) => {
    const temp = await createTempUser();
    try {
      await page.goto('/login');
      await page.locator('#email').fill(temp.user.email);
      await page.locator('#password').fill(temp.temporaryPassword);
      await page.getByRole('button', { name: 'Masuk', exact: true }).click();
      await page.waitForURL(/\/change-password/, { timeout: 10_000 });

      const newPassword = `UiPicked!${Date.now()}`;
      await page.locator('#currentPassword').fill(temp.temporaryPassword);
      await page.locator('#newPassword').fill(newPassword);
      await page.locator('#passwordConfirm').fill(newPassword);
      await page.getByRole('button', { name: /Simpan password baru/i }).click();

      await page.waitForURL(/\/login\?changed=1/, { timeout: 10_000 });
      await expect(page.getByRole('status')).toContainText(/berhasil diubah/i);

      // Confirm the new password actually works via the API.
      const relogin = await request.post('http://localhost:4000/api/v1/auth/login', {
        data: { email: temp.user.email, password: newPassword },
      });
      expect(relogin.ok()).toBeTruthy();
    } finally {
      await temp.cleanup();
    }
  });
});
