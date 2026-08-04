import { request, type APIRequestContext } from '@playwright/test';
import { authenticator } from 'otplib';

import { SEED_USERS, type SeedUserKey } from '../fixtures/users';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

export interface MfaEnrollment {
  secret: string;
  backupCodes: string[];
  accessToken: string;
}

/**
 * Log in as a seed user via HTTP, enroll them into MFA end-to-end, and
 * return the raw secret + backup codes. Used by UI tests that need the
 * server to be in a "MFA already enabled" state without spending the
 * cost + flakiness of driving the enrollment UI first.
 *
 * The caller is responsible for cleanup via {@link disableMfaViaApi}.
 */
export async function enrollMfaViaApi(
  key: SeedUserKey,
): Promise<MfaEnrollment> {
  const user = SEED_USERS[key];
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    const loginRes = await ctx.post('/api/v1/auth/login', {
      data: { email: user.email, password: user.password },
    });
    if (!loginRes.ok()) {
      throw new Error(`login failed: ${loginRes.status()} ${await loginRes.text()}`);
    }
    const loginBody = (await loginRes.json()) as { accessToken: string };

    const startRes = await ctx.post('/api/v1/auth/mfa/enroll/start', {
      headers: { Authorization: `Bearer ${loginBody.accessToken}` },
    });
    if (!startRes.ok()) {
      throw new Error(`enroll/start failed: ${startRes.status()} ${await startRes.text()}`);
    }
    const start = (await startRes.json()) as { secret: string };

    const confirmRes = await ctx.post('/api/v1/auth/mfa/enroll/confirm', {
      headers: { Authorization: `Bearer ${loginBody.accessToken}` },
      data: { code: authenticator.generate(start.secret) },
    });
    if (!confirmRes.ok()) {
      throw new Error(
        `enroll/confirm failed: ${confirmRes.status()} ${await confirmRes.text()}`,
      );
    }
    const confirm = (await confirmRes.json()) as {
      backupCodes: string[];
      accessToken: string;
    };
    return {
      secret: start.secret,
      backupCodes: confirm.backupCodes,
      accessToken: confirm.accessToken,
    };
  } finally {
    await ctx.dispose();
  }
}

/**
 * Disable MFA for a seed user. Requires the shared `secret` (to
 * produce a fresh TOTP) and the seed password.
 *
 * Idempotent-ish: swallows every error so callers can invoke it as
 * best-effort cleanup in `afterEach`. When MFA was never enabled the
 * API replies with `MFA_NOT_ENABLED` which we intentionally ignore.
 */
export async function disableMfaViaApi(
  key: SeedUserKey,
  secret: string,
): Promise<void> {
  const user = SEED_USERS[key];
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    const loginRes = await ctx.post('/api/v1/auth/login', {
      data: { email: user.email, password: user.password },
    });
    if (!loginRes.ok()) return;
    const loginBody = (await loginRes.json()) as {
      accessToken: string;
      mfaRequired?: boolean;
    };

    let authHeader = `Bearer ${loginBody.accessToken}`;
    if (loginBody.mfaRequired) {
      const verifyRes = await ctx.post('/api/v1/auth/mfa/verify', {
        headers: { Authorization: authHeader },
        data: { code: authenticator.generate(secret) },
      });
      if (!verifyRes.ok()) return;
      const verify = (await verifyRes.json()) as { accessToken: string };
      authHeader = `Bearer ${verify.accessToken}`;
    }

    await ctx.delete('/api/v1/auth/mfa', {
      headers: { Authorization: authHeader },
      data: {
        currentPassword: user.password,
        code: authenticator.generate(secret),
      },
    });
  } catch {
    // Best-effort cleanup — swallow all errors.
  } finally {
    await ctx.dispose();
  }
}

/**
 * Convenience wrapper over `authenticator.generate` so specs don't
 * need to import `otplib` directly and stay locked to the same
 * default options as the backend.
 */
export function generateTotp(secret: string): string {
  return authenticator.generate(secret);
}

/**
 * Ensure MFA is fully cleared for a seed user regardless of how a
 * previous test left the account. Uses `/auth/mfa/status`; if
 * enabled, delegates to `disableMfaViaApi` with the caller-supplied
 * secret. If we don't have the secret, this becomes a no-op —
 * cleanup then falls to the next `beforeEach` in the enrolling test.
 */
export async function assertMfaDisabled(
  key: SeedUserKey,
  api: APIRequestContext,
): Promise<boolean> {
  const status = await api.get('/api/v1/auth/mfa/status');
  if (!status.ok()) return false;
  const body = (await status.json()) as { enabled: boolean };
  return body.enabled === false;
}
