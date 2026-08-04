import { createHmac, randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';

/**
 * Fase 32e — Outbound webhook end-to-end.
 *
 * Wiring:
 *   1. HR registers a webhook endpoint whose URL points at the
 *      in-memory sink under `/api/v1/test-support/webhook-sink/receive`.
 *   2. HR exports a timesheet → API emits `timesheet.export.created`.
 *   3. E2E calls `POST /test-support/webhook/deliver-now` to force the
 *      worker to run immediately (avoid a 30s wait).
 *   4. E2E reads back the sink for that bucket and asserts:
 *        - Exactly one delivery with the expected event type.
 *        - `X-Workpulse-Signature` header validates HMAC-SHA256 of
 *          `${t}.${rawBody}` under the plaintext secret HR received
 *          at creation.
 *        - Payload envelope contains the expected fields.
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

test.describe('Webhooks — outbound delivery', () => {
  let bucket = '';
  let approvedPeriodId: string | null = null;

  test.beforeAll(async () => {
    bucket = randomUUID();
    for (const path of [
      'consent/prune',
      'timesheet/prune',
      'timesheet-export/prune',
      'webhook/prune',
    ]) {
      const ctx = await testSupport(path, { email: SEED_USERS.hr.email });
      await ctx.dispose();
    }

    // Same seeding pattern as the export test — build an APPROVED
    // period so the subsequent export commits successfully.
    const now = new Date();
    const prevMonthAnchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    const { request } = await import('@playwright/test');
    const genCtx = await request.newContext({ baseURL: API_URL });
    try {
      const genRes = await genCtx.post('/api/v1/test-support/timesheet/generate', {
        data: {
          email: SEED_USERS.hr.email,
          at: prevMonthAnchor.toISOString(),
        },
      });
      expect(genRes.ok()).toBeTruthy();
      const gen = (await genRes.json()) as { periodId: string };
      approvedPeriodId = gen.periodId;
      const approveRes = await genCtx.post('/api/v1/test-support/timesheet/approve-all', {
        data: {
          email: SEED_USERS.hr.email,
          periodId: approvedPeriodId,
        },
      });
      expect(approveRes.status()).toBe(204);
    } finally {
      await genCtx.dispose();
    }
  });

  test('HR creates a webhook, triggers export, and receives a signed payload', async () => {
    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    try {
      // 1. Register endpoint at the loopback sink.
      const sinkUrl = `${API_URL}/api/v1/test-support/webhook-sink/receive?bucket=${bucket}`;
      const created = await hr.ctx.post('/api/v1/admin/webhooks', {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
        data: {
          url: sinkUrl,
          description: 'e2e sink',
          events: ['TIMESHEET_EXPORT_CREATED'],
        },
      });
      expect(created.status()).toBe(201);
      const endpoint = (await created.json()) as {
        id: string;
        secret: string;
      };
      expect(endpoint.secret).toBeTruthy();

      // 2. Trigger a real export → enqueues a webhook delivery.
      const exp = await hr.ctx.post('/api/v1/admin/timesheet/exports', {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
        data: {
          periodId: approvedPeriodId,
          format: 'CSV',
          mode: 'SUMMARY',
        },
      });
      expect(exp.status()).toBe(200);
      const exportId = exp.headers()['x-export-id'] ?? '';
      expect(exportId).toBeTruthy();

      // 3. Force the worker to run right away.
      const deliver = await hr.ctx.post('/api/v1/test-support/webhook/deliver-now', {});
      expect(deliver.status()).toBe(204);

      // 4. Read the sink.
      const read = await hr.ctx.get(`/api/v1/test-support/webhook-sink/read?bucket=${bucket}`);
      expect(read.status()).toBe(200);
      const { items } = (await read.json()) as {
        items: Array<{
          receivedAt: string;
          headers: Record<string, string>;
          rawBody: string;
          body: {
            type: string;
            data: Record<string, unknown>;
            tenant: { companyId: string };
          };
        }>;
      };
      expect(items.length).toBe(1);
      const [got] = items;
      if (!got) throw new Error('sink returned no items');
      expect(got.body.type).toBe('timesheet.export.created');
      expect(got.body.data.exportId).toBe(exportId);
      expect(got.body.data.format).toBe('CSV');

      // 5. Verify signature over the EXACT bytes the sender used (raw
      // body string preserved by NestJS `rawBody: true`; JSON parse +
      // re-stringify does not guarantee byte parity).
      const rawBody = got.rawBody;
      const header = got.headers['x-workpulse-signature'];
      expect(header).toBeTruthy();
      const match = /^t=(\d+),v1=([0-9a-f]+)$/.exec(header ?? '');
      expect(match).not.toBeNull();
      const t = Number(match![1]);
      const v1 = match![2] as string;
      const expected = createHmac('sha256', endpoint.secret)
        .update(`${t}.${rawBody}`)
        .digest('hex');
      expect(v1).toBe(expected);

      // Delivery log should show SUCCEEDED.
      const log = await hr.ctx.get(`/api/v1/admin/webhooks/deliveries?endpointId=${endpoint.id}`, {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
      });
      expect(log.status()).toBe(200);
      const logBody = (await log.json()) as {
        items: Array<{ status: string; attemptCount: number }>;
      };
      expect(logBody.items.length).toBeGreaterThanOrEqual(1);
      expect(logBody.items[0]?.status).toBe('SUCCEEDED');
    } finally {
      await hr.ctx.dispose();
    }
  });

  test('URL pointing to a well-known metadata IP is refused (400)', async () => {
    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    try {
      const res = await hr.ctx.post('/api/v1/admin/webhooks', {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
        data: {
          url: 'http://169.254.169.254/latest/meta-data',
          events: ['TIMESHEET_EXPORT_CREATED'],
        },
      });
      expect(res.status()).toBe(400);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('WEBHOOK_URL_REJECTED');
    } finally {
      await hr.ctx.dispose();
    }
  });

  test('EMPLOYEE cannot list webhooks (403)', async () => {
    const emp = await login(SEED_USERS.employee.email, SEED_USERS.employee.password);
    try {
      const res = await emp.ctx.get('/api/v1/admin/webhooks', {
        headers: { Authorization: `Bearer ${emp.accessToken}` },
      });
      expect(res.status()).toBe(403);
    } finally {
      await emp.ctx.dispose();
    }
  });
});
