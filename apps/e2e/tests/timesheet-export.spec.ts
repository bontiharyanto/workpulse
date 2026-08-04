import { expect, test, type APIRequestContext } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';

/**
 * Fase 32c — Payroll export.
 *
 * Verifies:
 *   - HR can download a CSV + XLSX export for a period that has at
 *     least one APPROVED timesheet.
 *   - The response payload's SHA-256 matches the `X-Payload-Sha256`
 *     header AND the audit row returned by `GET /admin/timesheet/exports`.
 *   - A period with no APPROVED rows returns 400 EXPORT_EMPTY.
 *   - EMPLOYEE + SUPERVISOR are refused (403).
 */

test.describe.configure({ mode: 'serial' });

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

interface Login {
  ctx: APIRequestContext;
  accessToken: string;
}

async function login(email: string, password: string): Promise<Login> {
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

async function testSupport(
  path: string,
  data: Record<string, unknown>,
): Promise<APIRequestContext> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  await ctx.post(`/api/v1/test-support/${path}`, { data }).catch(() => undefined);
  return ctx;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
}

test.describe('Timesheet export — payroll CSV & XLSX', () => {
  let approvedPeriodId: string | null = null;
  let emptyPeriodId: string | null = null;

  test.beforeAll(async () => {
    // Reset from any prior E2E run.
    for (const email of [SEED_USERS.hr.email, SEED_USERS.employee.email]) {
      const ctx = await testSupport('consent/prune', { email });
      await ctx.dispose();
    }
    const ctx1 = await testSupport('timesheet/prune', { email: SEED_USERS.hr.email });
    await ctx1.dispose();
    const ctx2 = await testSupport('timesheet-export/prune', {
      email: SEED_USERS.hr.email,
    });
    await ctx2.dispose();

    // Generate two periods: one in the previous month (we'll auto-approve
    // it) and one in the month before that (we'll leave it empty so the
    // EXPORT_EMPTY branch fires).
    const now = new Date();
    const prevMonthAnchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    const prevPrevMonthAnchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 15));

    const { request } = await import('@playwright/test');

    const genCtx = await request.newContext({ baseURL: API_URL });
    const genRes = await genCtx.post('/api/v1/test-support/timesheet/generate', {
      data: { email: SEED_USERS.hr.email, at: prevMonthAnchor.toISOString() },
    });
    expect(genRes.ok(), 'generate previous month').toBeTruthy();
    const gen = (await genRes.json()) as { periodId: string };
    approvedPeriodId = gen.periodId;

    const gen2Res = await genCtx.post('/api/v1/test-support/timesheet/generate', {
      data: { email: SEED_USERS.hr.email, at: prevPrevMonthAnchor.toISOString() },
    });
    expect(gen2Res.ok(), 'generate month-before-previous').toBeTruthy();
    const gen2 = (await gen2Res.json()) as { periodId: string };
    emptyPeriodId = gen2.periodId;

    // Approve all timesheets in `approvedPeriodId` so it becomes eligible
    // to export. The other period stays in DRAFT and must be refused.
    const approveRes = await genCtx.post('/api/v1/test-support/timesheet/approve-all', {
      data: { email: SEED_USERS.hr.email, periodId: approvedPeriodId },
    });
    expect(approveRes.status()).toBe(204);
    await genCtx.dispose();
  });

  test('HR exports SUMMARY CSV; hash matches header + audit row', async () => {
    expect(approvedPeriodId).toBeTruthy();
    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    const res = await hr.ctx.post('/api/v1/admin/timesheet/exports', {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
      data: {
        periodId: approvedPeriodId,
        format: 'CSV',
        mode: 'SUMMARY',
        note: 'e2e-summary-csv',
      },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
    expect(res.headers()['content-disposition']).toContain('attachment');
    const headerHash = res.headers()['x-payload-sha256'];
    const exportId = res.headers()['x-export-id'];
    expect(headerHash).toBeTruthy();
    expect(exportId).toBeTruthy();

    const buf = new Uint8Array(await res.body());
    const localHash = await sha256Hex(buf);
    expect(localHash).toBe(headerHash);

    // BOM + at least one data row.
    expect(buf[0]).toBe(0xef);
    expect(buf.length).toBeGreaterThan(200);

    // Header row is the first line after the BOM.
    const text = Buffer.from(buf).toString('utf8').replace('\uFEFF', '');
    const [header] = text.split('\r\n');
    expect(header).toContain('employee_id');
    expect(header).toContain('regular_hours');

    // Audit row appears with the same hash + note.
    const list = await hr.ctx.get('/api/v1/admin/timesheet/exports', {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
    });
    expect(list.status()).toBe(200);
    const body = (await list.json()) as {
      items: Array<{
        id: string;
        format: string;
        mode: string;
        payloadSha256: string;
        note: string | null;
        bytes: number;
      }>;
    };
    const row = body.items.find((r) => r.id === exportId);
    expect(row, 'audit row should exist').toBeTruthy();
    expect(row!.payloadSha256).toBe(headerHash);
    expect(row!.format).toBe('CSV');
    expect(row!.mode).toBe('SUMMARY');
    expect(row!.note).toBe('e2e-summary-csv');
    expect(row!.bytes).toBe(buf.length);

    await hr.ctx.dispose();
  });

  test('HR exports DETAIL XLSX; content-type is xlsx', async () => {
    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    const res = await hr.ctx.post('/api/v1/admin/timesheet/exports', {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
      data: {
        periodId: approvedPeriodId,
        format: 'XLSX',
        mode: 'DETAIL',
      },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const buf = new Uint8Array(await res.body());
    // .xlsx is a zip archive → starts with "PK".
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    await hr.ctx.dispose();
  });

  test('empty period is refused with EXPORT_EMPTY', async () => {
    expect(emptyPeriodId).toBeTruthy();
    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    const res = await hr.ctx.post('/api/v1/admin/timesheet/exports', {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
      data: {
        periodId: emptyPeriodId,
        format: 'CSV',
        mode: 'SUMMARY',
      },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('EXPORT_EMPTY');
    await hr.ctx.dispose();
  });

  test('EMPLOYEE and SUPERVISOR are refused with 403', async () => {
    for (const account of [SEED_USERS.employee, SEED_USERS.supervisor]) {
      const s = await login(account.email, account.password);
      const res = await s.ctx.post('/api/v1/admin/timesheet/exports', {
        headers: { Authorization: `Bearer ${s.accessToken}` },
        data: {
          periodId: approvedPeriodId,
          format: 'CSV',
          mode: 'SUMMARY',
        },
      });
      expect(res.status(), `role=${account.email}`).toBe(403);
      await s.ctx.dispose();
    }
  });
});
