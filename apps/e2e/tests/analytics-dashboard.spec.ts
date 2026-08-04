import { expect, test, type APIRequestContext } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';

/**
 * Fase 33a — Executive KPI dashboard E2E (API-only).
 *
 * Flow:
 *   1. Prune analytics rows for the seed tenant so we start clean.
 *   2. Backfill a small deterministic range via the test-support
 *      endpoint (the same code the nightly cron runs).
 *   3. GET /admin/analytics/dashboard → assert every KPI tile is
 *      present with a sane shape (delta + trend + descriptor).
 *   4. GET /admin/analytics/timeseries → assert the returned points
 *      cover today inclusive.
 *   5. Assert non-HR roles are refused.
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

/** Y-M-D in Asia/Jakarta for `now`. Mirrors `todayInTz` in period.ts. */
function todayYmd(now: Date, timezone = 'Asia/Jakarta'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function daysBefore(ymd: string, n: number): string {
  const utc = Date.UTC(
    Number(ymd.slice(0, 4)),
    Number(ymd.slice(5, 7)) - 1,
    Number(ymd.slice(8, 10)),
  );
  const dt = new Date(utc - n * 86_400_000);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

test.beforeAll(async () => {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    await ctx.post('/api/v1/test-support/analytics/prune', {
      data: { email: SEED_USERS.hr.email },
    });
    const today = todayYmd(new Date());
    const from = daysBefore(today, 6);
    const to = daysBefore(today, 1);
    // Materialise the previous week so the "current" 7-day window has
    // yesterday + 5 days of history to sum, while today runs live.
    const bf = await ctx.post('/api/v1/test-support/analytics/backfill', {
      data: { email: SEED_USERS.hr.email, from, to },
    });
    expect(bf.status()).toBe(200);
    const body = (await bf.json()) as { daysProcessed: number };
    expect(body.daysProcessed).toBe(6);
  } finally {
    await ctx.dispose();
  }
});

test('HR sees a full dashboard payload with every KPI tile', async () => {
  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
  try {
    const res = await hr.ctx.get(
      '/api/v1/admin/analytics/dashboard?windowDays=7',
      {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
      },
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      window: { from: string; to: string; today: string; days: number };
      tiles: Array<{
        metricKey: string;
        label: string;
        currentValue: number;
        previousValue: number;
        delta: { absolute: number; trend: string };
      }>;
      lastComputedAt: string | null;
    };

    expect(body.window.days).toBe(7);
    // to === today for the current window
    expect(body.window.to).toBe(body.window.today);

    // Every one of the 9 canonical metrics must appear
    const keys = body.tiles.map((t) => t.metricKey).sort();
    expect(keys).toEqual([
      'ATTENDANCE_ABSENT_COUNT',
      'ATTENDANCE_LATE_COUNT',
      'ATTENDANCE_ON_TIME_RATE',
      'HEADCOUNT_ACTIVE',
      'HEADCOUNT_TERMINATED',
      'LEAVE_DAYS_APPROVED',
      'LEAVE_PENDING_COUNT',
      'OVERTIME_COST_IDR',
      'OVERTIME_HOURS',
    ]);

    // Snapshot rows exist thanks to the backfill in beforeAll.
    expect(body.lastComputedAt).not.toBeNull();

    // On-time rate must be a fraction 0..1 (server rendering rule).
    const onTime = body.tiles.find(
      (t) => t.metricKey === 'ATTENDANCE_ON_TIME_RATE',
    )!;
    expect(onTime.currentValue).toBeGreaterThanOrEqual(0);
    expect(onTime.currentValue).toBeLessThanOrEqual(1);
    expect(['UP_GOOD', 'UP_BAD', 'DOWN_GOOD', 'DOWN_BAD', 'FLAT']).toContain(
      onTime.delta.trend,
    );

    // Headcount must be a non-negative integer.
    const headcount = body.tiles.find((t) => t.metricKey === 'HEADCOUNT_ACTIVE')!;
    expect(Number.isInteger(headcount.currentValue)).toBe(true);
    expect(headcount.currentValue).toBeGreaterThanOrEqual(1);
  } finally {
    await hr.ctx.dispose();
  }
});

test('HR can request a timeseries for a specific metric', async () => {
  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
  try {
    const res = await hr.ctx.get(
      '/api/v1/admin/analytics/timeseries?metricKey=HEADCOUNT_ACTIVE&windowDays=7',
      {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
      },
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      metricKey: string;
      window: { from: string; to: string; today: string; days: number };
      points: Array<{ date: string; value: number; isToday: boolean }>;
    };
    expect(body.metricKey).toBe('HEADCOUNT_ACTIVE');
    // 7-day window ⇒ exactly 7 daily points, and the last one is today.
    expect(body.points.length).toBe(7);
    const last = body.points[body.points.length - 1]!;
    expect(last.date).toBe(body.window.today);
    expect(last.isToday).toBe(true);
    // Only ONE point may be `isToday`.
    expect(body.points.filter((p) => p.isToday).length).toBe(1);
  } finally {
    await hr.ctx.dispose();
  }
});

test('EMPLOYEE role is forbidden from both endpoints', async () => {
  const emp = await login(
    SEED_USERS.employee.email,
    SEED_USERS.employee.password,
  );
  try {
    const d = await emp.ctx.get('/api/v1/admin/analytics/dashboard', {
      headers: { Authorization: `Bearer ${emp.accessToken}` },
    });
    expect([401, 403]).toContain(d.status());

    const t = await emp.ctx.get(
      '/api/v1/admin/analytics/timeseries?metricKey=HEADCOUNT_ACTIVE',
      {
        headers: { Authorization: `Bearer ${emp.accessToken}` },
      },
    );
    expect([401, 403]).toContain(t.status());
  } finally {
    await emp.ctx.dispose();
  }
});

test('the analytics tick worker is idempotent', async () => {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    const tick1 = await ctx.post('/api/v1/test-support/analytics/tick', {
      data: {},
    });
    expect(tick1.status()).toBe(200);
    const body1 = (await tick1.json()) as {
      tenantsProcessed: number;
      tenantsFailed: number;
    };
    expect(body1.tenantsFailed).toBe(0);
    expect(body1.tenantsProcessed).toBeGreaterThanOrEqual(1);

    // Second tick == same shape (row-count in DB won't grow because of
    // the upsert; here we just want to confirm no crashes).
    const tick2 = await ctx.post('/api/v1/test-support/analytics/tick', {
      data: {},
    });
    expect(tick2.status()).toBe(200);
    const body2 = (await tick2.json()) as { tenantsFailed: number };
    expect(body2.tenantsFailed).toBe(0);
  } finally {
    await ctx.dispose();
  }
});
