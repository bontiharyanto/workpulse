import { createHmac, randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';

/**
 * Fase 32g — reopen APPROVED timesheet.
 *
 * Verifies:
 *   - HR can reopen an APPROVED row → status resets to DRAFT, reopenCount
 *     bumps, and the audit trail records the reason.
 *   - Employee (owner) receives a TIMESHEET_REOPENED notification.
 *   - Non-APPROVED rows refuse reopen (409) and short reasons refuse (400).
 *   - Employees / supervisors cannot invoke the endpoint (403).
 *   - Webhook `timesheet.reopened` fires and matches the HMAC signature.
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
    throw new Error(
      `login failed for ${email}: ${res.status()} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { accessToken: string };
  return { ctx, accessToken: body.accessToken };
}

async function testSupport<T = unknown>(
  path: string,
  data: Record<string, unknown> = {},
): Promise<T | undefined> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    const res = await ctx.post(`/api/v1/test-support/${path}`, { data });
    if (!res.ok()) return undefined;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : undefined;
  } finally {
    await ctx.dispose();
  }
}

async function seedApprovedTimesheet(): Promise<{
  timesheetId: string;
  periodId: string;
  ownerEmail: string;
}> {
  const now = new Date();
  // Anchor two months back — the earlier tests may have already used
  // "one month back" so we pick a distinct slot to avoid collisions.
  const at = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 15),
  );
  const gen = await testSupport<{ periodId: string }>('timesheet/generate', {
    email: SEED_USERS.hr.email,
    at: at.toISOString(),
  });
  if (!gen) throw new Error('timesheet generate failed');

  const approve = await testSupport('timesheet/approve-all', {
    email: SEED_USERS.hr.email,
    periodId: gen.periodId,
  });
  // approve-all is 204 → undefined
  expect(approve).toBeUndefined();

  // Pull the employee's approved row via /me/timesheet.
  const emp = await login(
    SEED_USERS.employee.email,
    SEED_USERS.employee.password,
  );
  try {
    const listRes = await emp.ctx.get('/api/v1/me/timesheet?limit=50', {
      headers: { Authorization: `Bearer ${emp.accessToken}` },
    });
    const items = (await listRes.json()) as Array<{
      id: string;
      periodId: string;
      status: string;
    }>;
    const mine = items.find((t) => t.periodId === gen.periodId);
    if (!mine) throw new Error('employee timesheet missing for period');
    expect(mine.status).toBe('APPROVED');
    return {
      timesheetId: mine.id,
      periodId: gen.periodId,
      ownerEmail: SEED_USERS.employee.email,
    };
  } finally {
    await emp.ctx.dispose();
  }
}

test.describe('Timesheet reopen (Fase 32g)', () => {
  test.beforeAll(async () => {
    for (const path of [
      'consent/prune',
      'timesheet/prune',
      'timesheet-export/prune',
      'webhook/prune',
      'notifications/prune',
    ]) {
      await testSupport(path, { email: SEED_USERS.hr.email });
    }
    await testSupport('notifications/prune', {
      email: SEED_USERS.employee.email,
    });
  });

  test('HR reopens APPROVED → DRAFT, bumps reopenCount, notifies owner', async () => {
    const seeded = await seedApprovedTimesheet();

    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    try {
      const reason = 'OT rate revised post-payroll — mohon submit ulang.';
      const res = await hr.ctx.post(
        `/api/v1/admin/timesheet/${encodeURIComponent(seeded.timesheetId)}/reopen`,
        {
          headers: { Authorization: `Bearer ${hr.accessToken}` },
          data: { reason },
        },
      );
      expect(res.status()).toBe(200);
      const body = (await res.json()) as {
        id: string;
        status: string;
        reopenCount: number;
      };
      expect(body.status).toBe('DRAFT');
      expect(body.reopenCount).toBe(1);

      // GET the row and confirm the denorm fields landed.
      const detail = await hr.ctx.get(
        `/api/v1/admin/timesheet/${encodeURIComponent(seeded.timesheetId)}`,
        { headers: { Authorization: `Bearer ${hr.accessToken}` } },
      );
      expect(detail.status()).toBe(200);
      const detailBody = (await detail.json()) as {
        status: string;
        reopenCount: number;
        lastReopenReason: string | null;
        lastReopenedAt: string | null;
      };
      expect(detailBody.status).toBe('DRAFT');
      expect(detailBody.reopenCount).toBe(1);
      expect(detailBody.lastReopenReason).toBe(reason);
      expect(detailBody.lastReopenedAt).toBeTruthy();
    } finally {
      await hr.ctx.dispose();
    }

    // Employee should see a TIMESHEET_REOPENED notification.
    const emp = await login(
      SEED_USERS.employee.email,
      SEED_USERS.employee.password,
    );
    try {
      const nRes = await emp.ctx.get('/api/v1/notifications?limit=50', {
        headers: { Authorization: `Bearer ${emp.accessToken}` },
      });
      expect(nRes.status()).toBe(200);
      const nItems = (await nRes.json()) as Array<{
        type: string;
        data: Record<string, unknown> | null;
      }>;
      const reopened = nItems.find(
        (n) =>
          n.type === 'TIMESHEET_REOPENED' &&
          n.data?.timesheetId === seeded.timesheetId,
      );
      expect(reopened, 'owner should get TIMESHEET_REOPENED').toBeTruthy();
    } finally {
      await emp.ctx.dispose();
    }
  });

  test('SUPERVISOR cannot reopen (403)', async () => {
    const seeded = await seedApprovedTimesheet();
    const sup = await login(
      SEED_USERS.supervisor.email,
      SEED_USERS.supervisor.password,
    );
    try {
      const res = await sup.ctx.post(
        `/api/v1/admin/timesheet/${encodeURIComponent(seeded.timesheetId)}/reopen`,
        {
          headers: { Authorization: `Bearer ${sup.accessToken}` },
          data: { reason: 'trying to reopen as supervisor' },
        },
      );
      expect(res.status()).toBe(403);
    } finally {
      await sup.ctx.dispose();
    }
  });

  test('EMPLOYEE cannot reopen (403)', async () => {
    const seeded = await seedApprovedTimesheet();
    const emp = await login(
      SEED_USERS.employee.email,
      SEED_USERS.employee.password,
    );
    try {
      const res = await emp.ctx.post(
        `/api/v1/admin/timesheet/${encodeURIComponent(seeded.timesheetId)}/reopen`,
        {
          headers: { Authorization: `Bearer ${emp.accessToken}` },
          data: { reason: 'i wanted to edit my own timesheet' },
        },
      );
      expect(res.status()).toBe(403);
    } finally {
      await emp.ctx.dispose();
    }
  });

  test('short reason is rejected (400)', async () => {
    const seeded = await seedApprovedTimesheet();
    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    try {
      const res = await hr.ctx.post(
        `/api/v1/admin/timesheet/${encodeURIComponent(seeded.timesheetId)}/reopen`,
        {
          headers: { Authorization: `Bearer ${hr.accessToken}` },
          data: { reason: 'salah' },
        },
      );
      expect(res.status()).toBe(400);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('TIMESHEET_REOPEN_REASON_INVALID');
    } finally {
      await hr.ctx.dispose();
    }
  });

  test('non-APPROVED status is refused (409)', async () => {
    // Take one of the (now DRAFT) rows and try to reopen again — the
    // second reopen must refuse because the row is no longer APPROVED.
    const seeded = await seedApprovedTimesheet();
    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    try {
      // First reopen puts it in DRAFT.
      const first = await hr.ctx.post(
        `/api/v1/admin/timesheet/${encodeURIComponent(seeded.timesheetId)}/reopen`,
        {
          headers: { Authorization: `Bearer ${hr.accessToken}` },
          data: { reason: 'first reopen to move away from APPROVED' },
        },
      );
      expect(first.status()).toBe(200);

      // Second reopen must 409 — row is DRAFT now.
      const second = await hr.ctx.post(
        `/api/v1/admin/timesheet/${encodeURIComponent(seeded.timesheetId)}/reopen`,
        {
          headers: { Authorization: `Bearer ${hr.accessToken}` },
          data: { reason: 'cannot reopen a DRAFT row — expect 409' },
        },
      );
      expect(second.status()).toBe(409);
      const body = (await second.json()) as { code?: string };
      expect(body.code).toBe('TIMESHEET_REOPEN_STATUS_INVALID');
    } finally {
      await hr.ctx.dispose();
    }
  });

  test('webhook `timesheet.reopened` is delivered with a valid signature', async () => {
    const bucket = randomUUID();
    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    try {
      // 1. Register a sink subscribed to TIMESHEET_REOPENED.
      const sinkUrl = `${API_URL}/api/v1/test-support/webhook-sink/receive?bucket=${bucket}`;
      const created = await hr.ctx.post('/api/v1/admin/webhooks', {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
        data: {
          url: sinkUrl,
          description: 'e2e reopen sink',
          events: ['TIMESHEET_REOPENED'],
        },
      });
      expect(created.status()).toBe(201);
      const endpoint = (await created.json()) as {
        id: string;
        secret: string;
      };

      // 2. Reopen an APPROVED row.
      const seeded = await seedApprovedTimesheet();
      const reason = 'Webhook test — vendor payroll should invalidate cache.';
      const reopenRes = await hr.ctx.post(
        `/api/v1/admin/timesheet/${encodeURIComponent(seeded.timesheetId)}/reopen`,
        {
          headers: { Authorization: `Bearer ${hr.accessToken}` },
          data: { reason },
        },
      );
      expect(reopenRes.status()).toBe(200);

      // 3. Force delivery.
      const deliver = await hr.ctx.post(
        '/api/v1/test-support/webhook/deliver-now',
        {},
      );
      expect(deliver.status()).toBe(204);

      // 4. Read sink.
      const read = await hr.ctx.get(
        `/api/v1/test-support/webhook-sink/read?bucket=${bucket}`,
      );
      expect(read.status()).toBe(200);
      const { items } = (await read.json()) as {
        items: Array<{
          headers: Record<string, string>;
          rawBody: string;
          body: {
            type: string;
            data: Record<string, unknown>;
          };
        }>;
      };
      expect(items.length).toBe(1);
      const [got] = items;
      if (!got) throw new Error('sink returned no items');
      expect(got.body.type).toBe('timesheet.reopened');
      expect(got.body.data.timesheetId).toBe(seeded.timesheetId);
      expect(got.body.data.reason).toBe(reason);
      // reopenCount may be >1 because earlier tests in this suite may
      // have already reopened the same row; the exact count only
      // matters for the first-reopen path (asserted in the previous
      // test in the file). Here we just care it's monotonic + >=1.
      expect(Number(got.body.data.reopenCount)).toBeGreaterThanOrEqual(1);

      // 5. Verify HMAC over the raw body.
      const header = got.headers['x-workpulse-signature'];
      expect(header).toBeTruthy();
      const match = /^t=(\d+),v1=([0-9a-f]+)$/.exec(header ?? '');
      expect(match).not.toBeNull();
      const t = Number(match![1]);
      const v1 = match![2] as string;
      const expected = createHmac('sha256', endpoint.secret)
        .update(`${t}.${got.rawBody}`)
        .digest('hex');
      expect(v1).toBe(expected);
    } finally {
      await hr.ctx.dispose();
    }
  });
});
