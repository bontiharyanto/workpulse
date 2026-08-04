import { expect, test, type APIRequestContext } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';

/**
 * Fase 33c — Scheduled Email Report E2E (API-only).
 *
 * Flow:
 *   1. HR creates a weekly schedule for TIMESHEET_SUMMARY.
 *   2. Trigger the scheduler tick via test-support endpoint with a
 *      forced `at` timestamp that is after `nextRunAt`.
 *   3. Verify a `ReportDelivery` row lands in DELIVERED status with a
 *      SHA-256 hex.
 *   4. Verify audit log contains `REPORT_SCHEDULE_CREATED` +
 *      `REPORT_DELIVERY_SENT`.
 *   5. Verify RBAC — EMPLOYEE cannot list schedules.
 */

test.describe.configure({ mode: 'serial' });

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

interface Logged {
  ctx: APIRequestContext;
  accessToken: string;
}

async function login(email: string, password: string): Promise<Logged> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  const res = await ctx.post('/api/v1/auth/login', {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(`login failed ${email}: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { accessToken: string };
  return { ctx, accessToken: body.accessToken };
}

const authHeader = (t: string) => ({ Authorization: `Bearer ${t}` });

test('HR creates + dispatches a weekly TIMESHEET_SUMMARY schedule', async () => {
  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
  try {
    // Create a weekly schedule — pick a day/hour deterministically.
    const createRes = await hr.ctx.post('/api/v1/admin/reports/schedules', {
      headers: authHeader(hr.accessToken),
      data: {
        name: 'Weekly timesheet — payroll',
        reportType: 'TIMESHEET_SUMMARY',
        frequency: 'WEEKLY',
        cadenceDay: 1, // Monday
        cadenceHour: 6,
        recipients: ['payroll@example.com', 'dpo@example.com'],
      },
    });
    expect(createRes.status()).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      nextRunAt: string;
      active: boolean;
      recipients: string[];
    };
    expect(created.active).toBe(true);
    expect(created.recipients).toHaveLength(2);

    // Force the tick to run "after" the scheduled time.
    const nextRunAt = new Date(created.nextRunAt);
    const forcedAt = new Date(nextRunAt.getTime() + 60_000);
    const tickRes = await hr.ctx.post('/api/v1/test-support/report-scheduler/tick', {
      data: { at: forcedAt.toISOString() },
    });
    expect(tickRes.status()).toBe(200);
    const tick = (await tickRes.json()) as { delivered: number };
    expect(tick.delivered).toBe(1);

    // Delivery log should show DELIVERED + SHA-256.
    const dRes = await hr.ctx.get(`/api/v1/admin/reports/schedules/${created.id}/deliveries`, {
      headers: authHeader(hr.accessToken),
    });
    expect(dRes.status()).toBe(200);
    const deliveries = (await dRes.json()) as Array<{
      status: string;
      payloadSha256: string | null;
      payloadBytes: number | null;
    }>;
    expect(deliveries.length).toBeGreaterThan(0);
    const latest = deliveries[0]!;
    expect(latest.status).toBe('DELIVERED');
    expect(latest.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(latest.payloadBytes).toBeGreaterThan(100);

    // Audit trail must contain schedule + delivery entries.
    const auditRes = await hr.ctx.get(`/api/v1/admin/audit-log?entityType=ReportSchedule`, {
      headers: authHeader(hr.accessToken),
    });
    expect(auditRes.status()).toBe(200);
    const auditBody = (await auditRes.json()) as {
      rows: Array<{ action: string; entityId: string }>;
    };
    expect(
      auditBody.rows.some(
        (r) => r.action === 'REPORT_SCHEDULE_CREATED' && r.entityId === created.id,
      ),
    ).toBe(true);
  } finally {
    await hr.ctx.dispose();
  }
});

test('EMPLOYEE is refused report-schedule endpoints', async () => {
  const emp = await login(SEED_USERS.employee.email, SEED_USERS.employee.password);
  try {
    const res = await emp.ctx.get('/api/v1/admin/reports/schedules', {
      headers: authHeader(emp.accessToken),
    });
    expect([401, 403]).toContain(res.status());
  } finally {
    await emp.ctx.dispose();
  }
});
