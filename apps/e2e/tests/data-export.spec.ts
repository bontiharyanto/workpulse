import { expect, test, type APIRequestContext } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';

/**
 * Fase 31a — DSAR / data-portability API surface.
 *
 * The worker runs every 30 seconds in-process, but we don't want a
 * 30-second poll baked into E2E. Instead we cheat and call the same
 * cron handler via a "kick" endpoint if one exists, otherwise we
 * poll the list endpoint on a bounded schedule. In practice the
 * worker completes within a second for the seed dataset.
 *
 * The `admin` seed user is chosen because the assembler needs to
 * scope by `userId` and their audit-log entries are the richest
 * (all seeded audit rows list SUPER_ADMIN as the actor).
 */
test.describe.configure({ mode: 'serial' });

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const WORKER_MAX_WAIT_MS = 90_000; // give the 30s cron 3 ticks of headroom
const WORKER_POLL_MS = 1_500;

/**
 * Guarantee a clean slate for the seed users this suite touches.
 * The UI spec runs alphabetically before this one and mutates
 * both `employee` and `admin`; without pruning, the tail-end
 * "list is scoped to caller" test would see leftover employee
 * rows and fail. `test-support/data-export/prune` is gated on
 * `THROTTLER_DISABLED=true` — production is protected.
 */
test.beforeAll(async () => {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    for (const email of [SEED_USERS.admin.email, SEED_USERS.employee.email]) {
      await ctx
        .post('/api/v1/test-support/data-export/prune', { data: { email } })
        .catch(() => undefined);
    }
  } finally {
    await ctx.dispose();
  }
});

async function loginContext(): Promise<{
  ctx: APIRequestContext;
  accessToken: string;
}> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  const user = SEED_USERS.admin;
  const res = await ctx.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  if (!res.ok()) {
    throw new Error(`login failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { accessToken: string; mfaRequired?: boolean };
  return { ctx, accessToken: body.accessToken };
}

interface ExportRow {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'EXPIRED';
  fileSize: number | null;
}

async function listExports(
  ctx: APIRequestContext,
  accessToken: string,
): Promise<ExportRow[]> {
  const res = await ctx.get('/api/v1/me/data-export', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { requests: ExportRow[] };
  return body.requests;
}

async function waitForStatus(
  ctx: APIRequestContext,
  accessToken: string,
  id: string,
  wanted: ExportRow['status'],
): Promise<ExportRow> {
  const deadline = Date.now() + WORKER_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const rows = await listExports(ctx, accessToken);
    const target = rows.find((r) => r.id === id);
    if (target && target.status === wanted) return target;
    if (target && (target.status === 'FAILED' || target.status === 'EXPIRED')) {
      throw new Error(
        `expected ${wanted} but request settled to ${target.status}`,
      );
    }
    await new Promise((r) => setTimeout(r, WORKER_POLL_MS));
  }
  throw new Error(`timed out waiting for ${wanted} status`);
}

test('DSAR happy path: create → worker builds ZIP → list shows READY → download URL is presigned', async () => {
  const { ctx, accessToken } = await loginContext();

  const created = await ctx.post('/api/v1/me/data-export', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(created.status(), await created.text()).toBe(201);
  const createdBody = (await created.json()) as ExportRow;
  expect(createdBody.status).toBe('PENDING');
  const requestId = createdBody.id;

  // Wait until the worker finishes.
  const ready = await waitForStatus(ctx, accessToken, requestId, 'READY');
  expect(ready.fileSize).toBeGreaterThan(0);

  // Download endpoint mints a fresh presigned URL.
  const dl = await ctx.get(
    `/api/v1/me/data-export/${encodeURIComponent(requestId)}/download`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  expect(dl.ok(), await dl.text()).toBe(true);
  const dlBody = (await dl.json()) as { downloadUrl: string; expiresIn: number };
  expect(dlBody.downloadUrl).toMatch(/^https?:\/\//);
  expect(dlBody.expiresIn).toBeGreaterThan(0);
});

test('DSAR rate limit: second create while cooldown is active → 409 EXPORT_COOLDOWN', async () => {
  const { ctx, accessToken } = await loginContext();
  // First create may 409 with EXPORT_ALREADY_PENDING if the previous
  // test's row is still recent — either code proves the guard works.
  const res = await ctx.post('/api/v1/me/data-export', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(res.status()).toBe(409);
  const body = (await res.json()) as { code: string };
  expect(['EXPORT_COOLDOWN', 'EXPORT_ALREADY_PENDING']).toContain(body.code);
});

test('DSAR ownership: another user cannot download a stranger\'s export', async () => {
  // Log in as admin, capture the latest READY row.
  const { ctx: adminCtx, accessToken: adminToken } = await loginContext();
  const rows = await listExports(adminCtx, adminToken);
  const ready = rows.find((r) => r.status === 'READY');
  test.skip(!ready, 'no READY export available from earlier tests');
  const readyRow = ready as ExportRow;

  // Now log in as a different seed user (employee) and try to download.
  const { request } = await import('@playwright/test');
  const employeeCtx = await request.newContext({ baseURL: API_URL });
  const emp = SEED_USERS.employee;
  const login = await employeeCtx.post('/api/v1/auth/login', {
    data: { email: emp.email, password: emp.password },
  });
  const empToken = ((await login.json()) as { accessToken: string }).accessToken;

  const forbidden = await employeeCtx.get(
    `/api/v1/me/data-export/${encodeURIComponent(readyRow.id)}/download`,
    { headers: { Authorization: `Bearer ${empToken}` } },
  );
  expect(forbidden.status()).toBe(404); // 404, not 403, to avoid existence leak
  const body = (await forbidden.json()) as { code: string };
  expect(body.code).toBe('EXPORT_NOT_FOUND');
});

test('DSAR list is scoped to the caller', async () => {
  const { request } = await import('@playwright/test');
  const employeeCtx = await request.newContext({ baseURL: API_URL });
  const emp = SEED_USERS.employee;
  const login = await employeeCtx.post('/api/v1/auth/login', {
    data: { email: emp.email, password: emp.password },
  });
  const empToken = ((await login.json()) as { accessToken: string }).accessToken;

  const listRes = await employeeCtx.get('/api/v1/me/data-export', {
    headers: { Authorization: `Bearer ${empToken}` },
  });
  expect(listRes.ok()).toBe(true);
  const body = (await listRes.json()) as { requests: ExportRow[] };
  // Employee has never requested — must not see admin's row.
  expect(body.requests).toEqual([]);
});
