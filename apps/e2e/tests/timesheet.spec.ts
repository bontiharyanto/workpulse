import { expect, test, type APIRequestContext } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';

/**
 * Fase 32a — timesheet foundation.
 *
 * Verifies:
 *   - HR can read + update the tenant `TimesheetConfig`.
 *   - Non-HR is refused config writes (403).
 *   - HR generate is idempotent (upserts Timesheet + entries).
 *   - Employee sees their own current-period rollup.
 *   - Employee cannot see peer timesheets.
 *   - Supervisor sees `direct-reports` scope; HR sees everyone.
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
    throw new Error(`login failed for ${email}: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { accessToken: string };
  return { ctx, accessToken: body.accessToken };
}

async function pruneTimesheets(email: string): Promise<void> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    await ctx
      .post('/api/v1/test-support/timesheet/prune', { data: { email } })
      .catch(() => undefined);
  } finally {
    await ctx.dispose();
  }
}

async function generateTimesheetsForCompany(
  email: string,
): Promise<{ periodId: string; timesheetsGenerated: number }> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    const res = await ctx.post('/api/v1/test-support/timesheet/generate', {
      data: { email },
    });
    expect(res.ok()).toBeTruthy();
    return (await res.json()) as {
      periodId: string;
      timesheetsGenerated: number;
    };
  } finally {
    await ctx.dispose();
  }
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

test.describe('Timesheet — config surface', () => {
  test.beforeAll(async () => {
    await pruneConsent(SEED_USERS.hr.email);
    await pruneTimesheets(SEED_USERS.hr.email);
  });

  test('HR reads + updates the tenant timesheet config', async () => {
    const { ctx, accessToken } = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);

    const getRes = await ctx.get('/api/v1/admin/timesheet/config', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(getRes.status()).toBe(200);
    const before = (await getRes.json()) as { periodType: string };
    expect(before.periodType).toBe('MONTHLY');

    const putRes = await ctx.put('/api/v1/admin/timesheet/config', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { periodType: 'CUTOFF', cutoffDayOfMonth: 25 },
    });
    expect(putRes.status()).toBe(200);
    const after = (await putRes.json()) as {
      periodType: string;
      cutoffDayOfMonth: number;
    };
    expect(after.periodType).toBe('CUTOFF');
    expect(after.cutoffDayOfMonth).toBe(25);

    await ctx.dispose();
  });

  test('non-HR cannot update the timesheet config (403)', async () => {
    const { ctx, accessToken } = await login(
      SEED_USERS.employee.email,
      SEED_USERS.employee.password,
    );
    const res = await ctx.put('/api/v1/admin/timesheet/config', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { periodType: 'WEEKLY' },
    });
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });

  test('config rejects out-of-range cutoffDayOfMonth (400)', async () => {
    const { ctx, accessToken } = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    const res = await ctx.put('/api/v1/admin/timesheet/config', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { cutoffDayOfMonth: 30 },
    });
    expect(res.status()).toBe(400);
    await ctx.dispose();
  });

  test.afterAll(async () => {
    // Restore the tenant to the shared-default MONTHLY so downstream
    // suites depending on the seed remain isolated.
    const { ctx, accessToken } = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    await ctx.put('/api/v1/admin/timesheet/config', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { periodType: 'MONTHLY', cutoffDayOfMonth: null },
    });
    await ctx.dispose();
  });
});

test.describe('Timesheet — generator + read surface', () => {
  test.beforeAll(async () => {
    await pruneConsent(SEED_USERS.hr.email);
    await pruneTimesheets(SEED_USERS.hr.email);
  });

  test('HR generate + self-view returns a timesheet with entries', async () => {
    const gen = await generateTimesheetsForCompany(SEED_USERS.hr.email);
    expect(gen.timesheetsGenerated).toBeGreaterThan(0);
    expect(gen.periodId).toMatch(/^c/); // cuid()

    const emp = await login(SEED_USERS.employee.email, SEED_USERS.employee.password);
    const currentRes = await emp.ctx.get('/api/v1/me/timesheet/current', {
      headers: { Authorization: `Bearer ${emp.accessToken}` },
    });
    expect(currentRes.status()).toBe(200);
    const current = (await currentRes.json()) as {
      id: string;
      entries: Array<{ workDate: string; kind: string }>;
      totals: { workingDays: number };
      user: { email: string };
    } | null;
    expect(current).not.toBeNull();
    expect(current!.user.email).toBe(SEED_USERS.employee.email);
    expect(current!.entries.length).toBeGreaterThan(0);
    await emp.ctx.dispose();
  });

  test('generate is idempotent — second run keeps the same periodId', async () => {
    const first = await generateTimesheetsForCompany(SEED_USERS.hr.email);
    const second = await generateTimesheetsForCompany(SEED_USERS.hr.email);
    expect(second.periodId).toBe(first.periodId);
  });

  test('employee cannot read a peer timesheet (404)', async () => {
    await generateTimesheetsForCompany(SEED_USERS.hr.email);

    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    const listRes = await hr.ctx.get('/api/v1/admin/timesheet?limit=200', {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
    });
    const list = (await listRes.json()) as {
      items: Array<{ id: string; user: { email: string } }>;
    };
    const peer = list.items.find((t) => t.user.email !== SEED_USERS.employee.email);
    expect(peer, 'HR should see at least one peer timesheet').toBeTruthy();
    await hr.ctx.dispose();

    const emp = await login(SEED_USERS.employee.email, SEED_USERS.employee.password);
    const peerRes = await emp.ctx.get(`/api/v1/me/timesheet/${encodeURIComponent(peer!.id)}`, {
      headers: { Authorization: `Bearer ${emp.accessToken}` },
    });
    // `/me/timesheet/:id` is service-scoped; a foreign ID → 403/404. We
    // accept either since the wrapper hides existence.
    expect([403, 404]).toContain(peerRes.status());
    await emp.ctx.dispose();
  });

  test('supervisor sees direct-reports only in /admin/timesheet', async () => {
    await generateTimesheetsForCompany(SEED_USERS.hr.email);

    const sup = await login(SEED_USERS.supervisor.email, SEED_USERS.supervisor.password);
    const supList = await sup.ctx.get('/api/v1/admin/timesheet?limit=200', {
      headers: { Authorization: `Bearer ${sup.accessToken}` },
    });
    expect(supList.status()).toBe(200);
    const supBody = (await supList.json()) as {
      total: number;
      items: Array<{ user: { email: string } }>;
    };
    // Supervisor should not see HR or SUPER_ADMIN rows.
    const emails = supBody.items.map((i) => i.user.email);
    expect(emails).not.toContain(SEED_USERS.hr.email);
    expect(emails).not.toContain(SEED_USERS.admin.email);
    await sup.ctx.dispose();

    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    const hrList = await hr.ctx.get('/api/v1/admin/timesheet?limit=200', {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
    });
    const hrBody = (await hrList.json()) as {
      total: number;
    };
    expect(hrBody.total).toBeGreaterThanOrEqual(supBody.total);
    await hr.ctx.dispose();
  });

  test('/admin/timesheet/periods returns the generated period', async () => {
    const gen = await generateTimesheetsForCompany(SEED_USERS.hr.email);
    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    const res = await hr.ctx.get('/api/v1/admin/timesheet/periods', {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; label: string }>;
    };
    expect(body.items.some((p) => p.id === gen.periodId)).toBe(true);
    await hr.ctx.dispose();
  });
});
