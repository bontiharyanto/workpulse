import { expect, test, type APIRequestContext } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';

/**
 * Fase 31c — retention automation + consent tracking API surface.
 *
 * The retention worker's cron is `0 0 2 * * *` (once per day). The
 * `test-support` controller exposes `/test-support/retention/tick` to
 * invoke `runOnce()` inline so a full lifecycle test finishes in
 * seconds. `age-notifications` fast-forwards notification `createdAt`
 * so the prune has candidates without a wall-clock wait.
 *
 * The consent tests use the same lever pattern: `consent/prune`
 * wipes the tenant policy + acceptance ledger to a blank slate.
 * Because `AuthController.toDto` reads `pendingConsent` on every
 * `/auth/me`, we can watch the flag flip in-flight without needing
 * a client-side cache-buster.
 */

test.describe.configure({ mode: 'serial' });

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

interface LoginedContext {
  ctx: APIRequestContext;
  accessToken: string;
}

async function login(email: string, password: string): Promise<LoginedContext> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  const res = await ctx.post('/api/v1/auth/login', {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(
      `login failed for ${email}: ${res.status()} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { accessToken: string };
  return { ctx, accessToken: body.accessToken };
}

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

async function primeRetention(email: string): Promise<void> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    await ctx
      .post('/api/v1/test-support/retention/prime', { data: { email } })
      .catch(() => undefined);
  } finally {
    await ctx.dispose();
  }
}

async function ageNotifications(
  email: string,
  ageDays: number,
): Promise<void> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    await ctx
      .post('/api/v1/test-support/retention/age-notifications', {
        data: { email, ageDays },
      })
      .catch(() => undefined);
  } finally {
    await ctx.dispose();
  }
}

async function tickRetentionWorker(): Promise<void> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    await ctx.post('/api/v1/test-support/retention/tick');
  } finally {
    await ctx.dispose();
  }
}

// ---------------------------------------------------------------------------
// Retention policy CRUD + bounds
// ---------------------------------------------------------------------------

test('HR can read + update the tenant retention policy', async () => {
  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);

  const readRes = await hr.ctx.get('/api/v1/admin/privacy/retention', {
    headers: { Authorization: `Bearer ${hr.accessToken}` },
  });
  expect(readRes.status()).toBe(200);
  const policy = (await readRes.json()) as {
    notificationRetentionDays: number;
    dataExportArchiveRetentionHours: number;
    terminatedUserAnonymizeDays: number;
  };
  expect(typeof policy.notificationRetentionDays).toBe('number');

  const updateRes = await hr.ctx.put('/api/v1/admin/privacy/retention', {
    headers: { Authorization: `Bearer ${hr.accessToken}` },
    data: {
      notificationRetentionDays: 60,
      dataExportArchiveRetentionHours: 48,
      terminatedUserAnonymizeDays: 30,
    },
  });
  expect(updateRes.status()).toBe(200);
  const updated = (await updateRes.json()) as {
    notificationRetentionDays: number;
    dataExportArchiveRetentionHours: number;
    terminatedUserAnonymizeDays: number;
  };
  expect(updated.notificationRetentionDays).toBe(60);
  expect(updated.dataExportArchiveRetentionHours).toBe(48);
  expect(updated.terminatedUserAnonymizeDays).toBe(30);

  await hr.ctx.dispose();
});

test('non-HR is forbidden from touching retention', async () => {
  const employee = await login(
    SEED_USERS.employee.email,
    SEED_USERS.employee.password,
  );
  const res = await employee.ctx.get('/api/v1/admin/privacy/retention', {
    headers: { Authorization: `Bearer ${employee.accessToken}` },
  });
  expect(res.status()).toBe(403);
  await employee.ctx.dispose();
});

test('retention update rejects out-of-bounds values', async () => {
  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
  const res = await hr.ctx.put('/api/v1/admin/privacy/retention', {
    headers: { Authorization: `Bearer ${hr.accessToken}` },
    data: { notificationRetentionDays: 5000 },
  });
  expect(res.status()).toBe(400);
  await hr.ctx.dispose();
});

// ---------------------------------------------------------------------------
// Retention worker: prune notifications older than N days
// ---------------------------------------------------------------------------

test('retention worker prunes notifications older than the retention window', async () => {
  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
  const employee = await login(
    SEED_USERS.employee.email,
    SEED_USERS.employee.password,
  );

  await primeRetention(SEED_USERS.employee.email);

  // Set the tenant's retention to 30 days so any notification aged
  // past that will be swept.
  await hr.ctx.put('/api/v1/admin/privacy/retention', {
    headers: { Authorization: `Bearer ${hr.accessToken}` },
    data: {
      notificationRetentionDays: 30,
    },
  });

  // Age every notification in the tenant by 100 days.
  await ageNotifications(SEED_USERS.employee.email, 100);

  // Count before.
  const beforeRes = await employee.ctx.get('/api/v1/notifications', {
    headers: { Authorization: `Bearer ${employee.accessToken}` },
  });
  expect(beforeRes.status()).toBe(200);

  // Kick the worker inline.
  await tickRetentionWorker();

  // Count after — the prune deleted every aged notification so the
  // employee's inbox should either be empty or (post-first-page)
  // strictly smaller. We assert "no aged rows survive" by requesting
  // and observing the tail: no createdAt should be older than 30d.
  const afterRes = await employee.ctx.get('/api/v1/notifications', {
    headers: { Authorization: `Bearer ${employee.accessToken}` },
  });
  expect(afterRes.status()).toBe(200);
  const { items = [] } = (await afterRes.json()) as {
    items?: Array<{ createdAt: string }>;
  };
  const cutoff = Date.now() - 30 * 86_400_000;
  for (const row of items) {
    expect(new Date(row.createdAt).getTime()).toBeGreaterThan(cutoff);
  }

  await hr.ctx.dispose();
  await employee.ctx.dispose();
});

// ---------------------------------------------------------------------------
// Consent lifecycle
// ---------------------------------------------------------------------------

test('after publishing a new policy every non-consenting user sees pendingConsent', async () => {
  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
  await pruneConsent(SEED_USERS.hr.email);

  // Publish v1.
  const version = `e2e-${Date.now()}`;
  const publishRes = await hr.ctx.post('/api/v1/admin/privacy/policies', {
    headers: { Authorization: `Bearer ${hr.accessToken}` },
    data: {
      version,
      title: 'Kebijakan E2E',
      body: 'Ini kebijakan uji.',
    },
  });
  expect(publishRes.status()).toBe(201);
  const policy = (await publishRes.json()) as { id: string; version: string };
  expect(policy.version).toBe(version);

  // A fresh login as an employee → pendingConsent surfaces.
  const employee = await login(
    SEED_USERS.employee.email,
    SEED_USERS.employee.password,
  );
  const meRes = await employee.ctx.get('/api/v1/auth/me', {
    headers: { Authorization: `Bearer ${employee.accessToken}` },
  });
  expect(meRes.status()).toBe(200);
  const me = (await meRes.json()) as {
    pendingConsent: { id: string; version: string } | null;
  };
  expect(me.pendingConsent?.version).toBe(version);

  // Every non-consent route now 403s with CONSENT_REQUIRED.
  const gatedRes = await employee.ctx.get('/api/v1/notifications', {
    headers: { Authorization: `Bearer ${employee.accessToken}` },
  });
  expect(gatedRes.status()).toBe(403);
  const gatedBody = (await gatedRes.json()) as { code: string };
  expect(gatedBody.code).toBe('CONSENT_REQUIRED');

  // Accept the policy.
  const acceptRes = await employee.ctx.post('/api/v1/me/consent', {
    headers: { Authorization: `Bearer ${employee.accessToken}` },
    data: { policyId: policy.id },
  });
  expect(acceptRes.status()).toBe(200);

  // Now `/auth/me` reports pendingConsent=null and gated routes work.
  const meAfterRes = await employee.ctx.get('/api/v1/auth/me', {
    headers: { Authorization: `Bearer ${employee.accessToken}` },
  });
  const meAfter = (await meAfterRes.json()) as {
    pendingConsent: unknown | null;
  };
  expect(meAfter.pendingConsent).toBeNull();

  const unblockedRes = await employee.ctx.get('/api/v1/notifications', {
    headers: { Authorization: `Bearer ${employee.accessToken}` },
  });
  expect(unblockedRes.status()).toBe(200);

  await hr.ctx.dispose();
  await employee.ctx.dispose();

  // Cleanup so subsequent tests don't get force-routed to /consent.
  await pruneConsent(SEED_USERS.employee.email);
});

test('publishing the same version twice returns 409', async () => {
  // Start each dup test from a clean slate — a leftover policy from
  // the previous test would set HR's pendingConsent and short-circuit
  // this one with a 403 before we ever reach the uniqueness check.
  await pruneConsent(SEED_USERS.hr.email);

  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
  const dup = `dup-${Date.now()}`;
  const first = await hr.ctx.post('/api/v1/admin/privacy/policies', {
    headers: { Authorization: `Bearer ${hr.accessToken}` },
    data: { version: dup, title: 't', body: 'b' },
  });
  expect(first.status()).toBe(201);
  const firstBody = (await first.json()) as { id: string };

  // After publishing HR now has `pendingConsent` for the row they
  // just created. Accept it so the second call reaches the DB
  // (otherwise the guard 403s before the uniqueness check).
  const acceptRes = await hr.ctx.post('/api/v1/me/consent', {
    headers: { Authorization: `Bearer ${hr.accessToken}` },
    data: { policyId: firstBody.id },
  });
  expect(acceptRes.status()).toBe(200);

  const second = await hr.ctx.post('/api/v1/admin/privacy/policies', {
    headers: { Authorization: `Bearer ${hr.accessToken}` },
    data: { version: dup, title: 't', body: 'b' },
  });
  expect(second.status()).toBe(409);

  await hr.ctx.dispose();

  await pruneConsent(SEED_USERS.hr.email);
  await pruneConsent(SEED_USERS.employee.email);
});

test('non-HR is forbidden from publishing a policy', async () => {
  const employee = await login(
    SEED_USERS.employee.email,
    SEED_USERS.employee.password,
  );
  const res = await employee.ctx.post('/api/v1/admin/privacy/policies', {
    headers: { Authorization: `Bearer ${employee.accessToken}` },
    data: { version: 'nope', title: 't', body: 'b' },
  });
  expect(res.status()).toBe(403);
  await employee.ctx.dispose();
});

test.afterAll(async () => {
  // Global cleanup — leave every seed tenant in a clean state so the
  // rest of the suite (especially the DSAR / erasure specs) doesn't
  // trip over a leftover pendingConsent gate.
  for (const u of [
    SEED_USERS.employee.email,
    SEED_USERS.supervisor.email,
    SEED_USERS.hr.email,
    SEED_USERS.admin.email,
  ]) {
    await pruneConsent(u);
  }
});
