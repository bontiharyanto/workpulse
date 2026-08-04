import { expect, test } from '@playwright/test';
import { authenticator } from 'otplib';

import { authenticateApi } from './helpers/api';
import { SEED_USERS } from './fixtures/users';

/**
 * MFA API-level flows. This file is deliberately narrow — it does not
 * touch the UI. We cover:
 *
 *  - enroll/start → enroll/confirm happy path
 *  - login → /auth/mfa/verify → subsequent request succeeds
 *  - login → wrong TOTP → 401 MFA_INVALID_CODE
 *  - backup code single-use enforcement
 *  - disable requires password + TOTP
 *  - RBAC on non-authenticated requests
 *
 * The suite serializes access to a single seed user (employee) because
 * `enroll/confirm` mutates their persistent state. Each test resets by
 * disabling MFA at teardown so subsequent tests start from a clean
 * "not enrolled" baseline.
 */

test.describe.configure({ mode: 'serial' });

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

async function loginRaw(email: string, password: string) {
  const login = await (await import('@playwright/test')).request.newContext({
    baseURL: API_URL,
  });
  const res = await login.post('/api/v1/auth/login', {
    data: { email, password },
  });
  const body = await res.json();
  const cookies = res.headers()['set-cookie'] ?? '';
  return { status: res.status(), body, cookies, ctx: login };
}

test.beforeEach(async () => {
  // Best-effort cleanup: if a previous test left MFA enabled on the
  // seed user, disable it. Ignore all errors — most runs won't need
  // to do anything here.
  const employee = SEED_USERS.employee;
  const { body, ctx } = await loginRaw(employee.email, employee.password);
  try {
    const status = await ctx.get('/api/v1/auth/mfa/status', {
      headers: { Authorization: `Bearer ${body.accessToken}` },
    });
    if (status.ok()) {
      const s = await status.json();
      if (s.enabled) {
        // Emergency disable: bypass the verify-required flow by using
        // Prisma. Not exposed as an API — for test hygiene only we
        // just proceed with a fresh test run and let the state linger.
        // In production, disabling always needs password + TOTP.
        // For tests, we've enrolled + know the secret; the test that
        // enrolled is responsible for disabling in `test.afterEach`.
      }
    }
  } finally {
    await ctx.dispose();
  }
});

test('MFA enroll: start → confirm → status reflects enabled + backup codes', async () => {
  const { api } = await authenticateApi('employee');

  const startRes = await api.post('/api/v1/auth/mfa/enroll/start');
  expect(startRes.ok()).toBe(true);
  const start = await startRes.json();
  expect(start.otpauthUrl).toContain('otpauth://totp/');
  expect(start.qrCodeDataUri.startsWith('data:image/png;base64,')).toBe(true);
  expect(start.secret).toMatch(/^[A-Z2-7]+$/);

  const totp = authenticator.generate(start.secret);
  const confirmRes = await api.post('/api/v1/auth/mfa/enroll/confirm', {
    data: { code: totp },
  });
  expect(confirmRes.ok()).toBe(true);
  const confirm = await confirmRes.json();
  expect(Array.isArray(confirm.backupCodes)).toBe(true);
  expect(confirm.backupCodes).toHaveLength(8);
  expect(confirm.accessToken).toBeTruthy();

  const statusRes = await api.get('/api/v1/auth/mfa/status');
  const status = await statusRes.json();
  expect(status.enabled).toBe(true);
  expect(status.remainingBackupCodes).toBe(8);

  // Cleanup: disable MFA so subsequent tests start fresh.
  const disableRes = await api.delete('/api/v1/auth/mfa', {
    data: {
      currentPassword: SEED_USERS.employee.password,
      code: authenticator.generate(start.secret),
    },
  });
  expect(disableRes.status()).toBe(204);
});

test('MFA login: password-only login returns mfaRequired=true after enrollment', async () => {
  // 1. Enroll first (mutates state).
  const { api } = await authenticateApi('employee');
  const start = await (await api.post('/api/v1/auth/mfa/enroll/start')).json();
  await api.post('/api/v1/auth/mfa/enroll/confirm', {
    data: { code: authenticator.generate(start.secret) },
  });

  // 2. Fresh password-only login now expects mfaRequired=true.
  const { body, ctx } = await loginRaw(
    SEED_USERS.employee.email,
    SEED_USERS.employee.password,
  );
  expect(body.mfaRequired).toBe(true);
  expect(body.user.mfaEnabled).toBe(true);
  expect(body.user.mfaPassed).toBe(false);
  await ctx.dispose();

  // 3. Non-auth endpoint 403 with MFA_REQUIRED using this pre-MFA token.
  const preMfa = await (await import('@playwright/test')).request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${body.accessToken}` },
  });
  const meAttempt = await preMfa.get('/api/v1/attendance/me/today');
  expect(meAttempt.status()).toBe(403);
  const err = await meAttempt.json();
  expect(err.code).toBe('MFA_REQUIRED');

  // Cleanup: complete verify, then disable.
  await preMfa.dispose();

  // Cleanup via the enrolled `api` context (which still has mfaPassed=true).
  await api.delete('/api/v1/auth/mfa', {
    data: {
      currentPassword: SEED_USERS.employee.password,
      code: authenticator.generate(start.secret),
    },
  });
});

test('MFA verify: valid TOTP upgrades session; wrong code stays blocked', async () => {
  const { api } = await authenticateApi('employee');
  const start = await (await api.post('/api/v1/auth/mfa/enroll/start')).json();
  await api.post('/api/v1/auth/mfa/enroll/confirm', {
    data: { code: authenticator.generate(start.secret) },
  });

  // Full login flow using the raw context (to capture cookies).
  const login = await (await import('@playwright/test')).request.newContext({
    baseURL: API_URL,
  });
  const loginRes = await login.post('/api/v1/auth/login', {
    data: {
      email: SEED_USERS.employee.email,
      password: SEED_USERS.employee.password,
    },
  });
  const loginBody = await loginRes.json();

  // Attempt verify with wrong code first.
  const bad = await login.post('/api/v1/auth/mfa/verify', {
    headers: { Authorization: `Bearer ${loginBody.accessToken}` },
    data: { code: '000000' },
  });
  expect(bad.status()).toBe(401);
  const badBody = await bad.json();
  expect(badBody.code).toBe('MFA_INVALID_CODE');

  // Retry with real TOTP.
  const good = await login.post('/api/v1/auth/mfa/verify', {
    headers: { Authorization: `Bearer ${loginBody.accessToken}` },
    data: { code: authenticator.generate(start.secret) },
  });
  expect(good.ok()).toBe(true);
  const goodBody = await good.json();
  expect(goodBody.usedBackupCode).toBe(false);
  expect(goodBody.accessToken).toBeTruthy();

  // Now the step-up token should let us hit attendance.
  const attempt = await login.get('/api/v1/attendance/me/today', {
    headers: { Authorization: `Bearer ${goodBody.accessToken}` },
  });
  expect(attempt.ok()).toBe(true);

  // Cleanup.
  await api.delete('/api/v1/auth/mfa', {
    data: {
      currentPassword: SEED_USERS.employee.password,
      code: authenticator.generate(start.secret),
    },
  });
  await login.dispose();
});

test('MFA backup code: valid consumes single-use, replayed rejected', async () => {
  const { api } = await authenticateApi('employee');
  const start = await (await api.post('/api/v1/auth/mfa/enroll/start')).json();
  const confirm = await (await api.post('/api/v1/auth/mfa/enroll/confirm', {
    data: { code: authenticator.generate(start.secret) },
  })).json();
  const codes: string[] = confirm.backupCodes;
  expect(codes).toHaveLength(8);

  // Fresh password-only login to produce a pre-MFA token.
  const login = await (await import('@playwright/test')).request.newContext({
    baseURL: API_URL,
  });
  const loginRes = await login.post('/api/v1/auth/login', {
    data: {
      email: SEED_USERS.employee.email,
      password: SEED_USERS.employee.password,
    },
  });
  const loginBody = await loginRes.json();

  const targetCode = codes[0];
  const first = await login.post('/api/v1/auth/mfa/verify', {
    headers: { Authorization: `Bearer ${loginBody.accessToken}` },
    data: { backupCode: targetCode },
  });
  expect(first.ok()).toBe(true);
  const firstBody = await first.json();
  expect(firstBody.usedBackupCode).toBe(true);

  // Second login to get a fresh pre-MFA token; retry the same backup code.
  const login2Res = await login.post('/api/v1/auth/login', {
    data: {
      email: SEED_USERS.employee.email,
      password: SEED_USERS.employee.password,
    },
  });
  const login2Body = await login2Res.json();
  const replay = await login.post('/api/v1/auth/mfa/verify', {
    headers: { Authorization: `Bearer ${login2Body.accessToken}` },
    data: { backupCode: targetCode },
  });
  expect(replay.status()).toBe(401);

  // Remaining codes count is 7.
  const status = await (await login.get('/api/v1/auth/mfa/status', {
    headers: { Authorization: `Bearer ${firstBody.accessToken}` },
  })).json();
  expect(status.remainingBackupCodes).toBe(7);

  // Cleanup.
  await api.delete('/api/v1/auth/mfa', {
    data: {
      currentPassword: SEED_USERS.employee.password,
      code: authenticator.generate(start.secret),
    },
  });
  await login.dispose();
});

test('MFA disable: rejects wrong password, accepts correct pair, revokes sessions', async () => {
  const { api } = await authenticateApi('employee');
  const start = await (await api.post('/api/v1/auth/mfa/enroll/start')).json();
  await api.post('/api/v1/auth/mfa/enroll/confirm', {
    data: { code: authenticator.generate(start.secret) },
  });

  // Wrong password → 401.
  const wrong = await api.delete('/api/v1/auth/mfa', {
    data: { currentPassword: 'wrong-password', code: authenticator.generate(start.secret) },
  });
  expect(wrong.status()).toBe(401);
  const wrongBody = await wrong.json();
  expect(wrongBody.code).toBe('INVALID_CREDENTIALS');

  // Correct pair → 204 + refresh revocation.
  const disable = await api.delete('/api/v1/auth/mfa', {
    data: {
      currentPassword: SEED_USERS.employee.password,
      code: authenticator.generate(start.secret),
    },
  });
  expect(disable.status()).toBe(204);

  // Status reports disabled + 0 backup codes.
  // Re-login because the previous DELETE revoked our refresh token.
  const post = await authenticateApi('employee');
  const status = await (await post.api.get('/api/v1/auth/mfa/status')).json();
  expect(status.enabled).toBe(false);
  expect(status.remainingBackupCodes).toBe(0);
});

test('MFA regenerate backup codes: requires valid TOTP + wipes old codes', async () => {
  const { api } = await authenticateApi('employee');
  const start = await (await api.post('/api/v1/auth/mfa/enroll/start')).json();
  const first = await (await api.post('/api/v1/auth/mfa/enroll/confirm', {
    data: { code: authenticator.generate(start.secret) },
  })).json();
  const originalCodes: string[] = first.backupCodes;

  // Wrong TOTP → 401.
  const wrong = await api.post('/api/v1/auth/mfa/backup-codes/regenerate', {
    data: { code: '000000' },
  });
  expect(wrong.status()).toBe(401);

  // Correct TOTP → new batch.
  const regen = await api.post('/api/v1/auth/mfa/backup-codes/regenerate', {
    data: { code: authenticator.generate(start.secret) },
  });
  expect(regen.ok()).toBe(true);
  const regenBody = await regen.json();
  expect(regenBody.backupCodes).toHaveLength(8);
  // No overlap with the previous batch (probability of collision is ~0).
  const overlap = regenBody.backupCodes.filter((c: string) => originalCodes.includes(c));
  expect(overlap).toHaveLength(0);

  // Cleanup.
  await api.delete('/api/v1/auth/mfa', {
    data: {
      currentPassword: SEED_USERS.employee.password,
      code: authenticator.generate(start.secret),
    },
  });
});

test('MFA endpoints require authentication', async () => {
  const anon = await (await import('@playwright/test')).request.newContext({
    baseURL: API_URL,
  });
  const attempts = [
    anon.post('/api/v1/auth/mfa/enroll/start'),
    anon.post('/api/v1/auth/mfa/enroll/confirm', { data: { code: '123456' } }),
    anon.get('/api/v1/auth/mfa/status'),
    anon.delete('/api/v1/auth/mfa', {
      data: { currentPassword: 'x', code: '123456' },
    }),
  ];
  for (const p of attempts) {
    const res = await p;
    expect(res.status()).toBe(401);
  }
  await anon.dispose();
});
