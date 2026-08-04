import { expect, test, type APIRequestContext } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';

/**
 * Fase 32d — Signed download URL for timesheet payroll exports.
 *
 * Verifies:
 *   - HR mints a signed URL for an APPROVED export.
 *   - Anonymous GET on the URL returns 200 + bytes identical to the
 *     originally-exported payload (both SHA-256s match).
 *   - The `downloadCount` on the audit row increments after each
 *     anonymous download.
 *   - A tampered signature returns 403.
 *   - Revoking the share renders the same URL 403 immediately.
 *   - Non-HR actors cannot mint a share.
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

test.describe('Timesheet export — signed share URL', () => {
  let approvedPeriodId: string | null = null;
  let exportId: string | null = null;
  let exportedHash: string | null = null;

  test.beforeAll(async () => {
    // Fresh slate. The 32c export test already covers seed setup;
    // here we just make sure the same slate applies without depending
    // on test-file ordering.
    const consentCtx1 = await testSupport('consent/prune', {
      email: SEED_USERS.hr.email,
    });
    await consentCtx1.dispose();
    const pruneCtx = await testSupport('timesheet/prune', {
      email: SEED_USERS.hr.email,
    });
    await pruneCtx.dispose();
    const pruneExportsCtx = await testSupport('timesheet-export/prune', {
      email: SEED_USERS.hr.email,
    });
    await pruneExportsCtx.dispose();

    const now = new Date();
    const prevMonthAnchor = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15),
    );
    const { request } = await import('@playwright/test');
    const genCtx = await request.newContext({ baseURL: API_URL });
    try {
      const genRes = await genCtx.post(
        '/api/v1/test-support/timesheet/generate',
        {
          data: {
            email: SEED_USERS.hr.email,
            at: prevMonthAnchor.toISOString(),
          },
        },
      );
      expect(genRes.ok()).toBeTruthy();
      const gen = (await genRes.json()) as { periodId: string };
      approvedPeriodId = gen.periodId;

      const approveRes = await genCtx.post(
        '/api/v1/test-support/timesheet/approve-all',
        {
          data: {
            email: SEED_USERS.hr.email,
            periodId: approvedPeriodId,
          },
        },
      );
      expect(approveRes.status()).toBe(204);
    } finally {
      await genCtx.dispose();
    }

    // Have HR trigger a CSV export so we have something to share.
    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    const exp = await hr.ctx.post('/api/v1/admin/timesheet/exports', {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
      data: {
        periodId: approvedPeriodId,
        format: 'CSV',
        mode: 'SUMMARY',
      },
    });
    expect(exp.status()).toBe(200);
    exportId = exp.headers()['x-export-id'] ?? null;
    exportedHash = exp.headers()['x-payload-sha256'] ?? null;
    expect(exportId).toBeTruthy();
    expect(exportedHash).toBeTruthy();
    await hr.ctx.dispose();
  });

  test('HR mints a share URL; anonymous GET returns byte-identical payload', async () => {
    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    const shareRes = await hr.ctx.post(
      `/api/v1/admin/timesheet/exports/${encodeURIComponent(exportId!)}/shares`,
      {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
        data: { ttlHours: 24, note: 'e2e' },
      },
    );
    expect(shareRes.status()).toBe(201);
    const share = (await shareRes.json()) as {
      id: string;
      url: string;
      expiresAt: string;
    };
    expect(share.url).toContain('/api/v1/public/timesheet-exports/download');
    await hr.ctx.dispose();

    // Anonymous fetch — new context, NO auth header.
    const { request } = await import('@playwright/test');
    const anon = await request.newContext();
    try {
      const dl = await anon.get(share.url);
      expect(dl.status()).toBe(200);
      expect(dl.headers()['x-payload-sha256']).toBe(exportedHash);
      const bytes = new Uint8Array(await dl.body());
      expect(await sha256Hex(bytes)).toBe(exportedHash);

      // downloadCount should now be 1 on the share row.
      const hr2 = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
      const list = await hr2.ctx.get(
        `/api/v1/admin/timesheet/exports/${encodeURIComponent(exportId!)}/shares`,
        { headers: { Authorization: `Bearer ${hr2.accessToken}` } },
      );
      expect(list.status()).toBe(200);
      const body = (await list.json()) as {
        items: Array<{ id: string; downloadCount: number; active: boolean }>;
      };
      const row = body.items.find((x) => x.id === share.id);
      expect(row?.downloadCount).toBe(1);
      expect(row?.active).toBe(true);
      await hr2.ctx.dispose();
    } finally {
      await anon.dispose();
    }
  });

  test('tampered signature returns 403 (400 from BadRequest thrown as SHARE_INVALID)', async () => {
    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    const shareRes = await hr.ctx.post(
      `/api/v1/admin/timesheet/exports/${encodeURIComponent(exportId!)}/shares`,
      {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
        data: { ttlHours: 24 },
      },
    );
    const share = (await shareRes.json()) as { url: string };
    await hr.ctx.dispose();

    const url = new URL(share.url);
    const goodSig = url.searchParams.get('signature') ?? '';
    // Flip one char while keeping length so we exercise the HMAC path
    // and not the "wrong length" short-circuit.
    const tampered =
      goodSig.slice(0, -1) + (goodSig.endsWith('A') ? 'B' : 'A');
    url.searchParams.set('signature', tampered);

    const { request } = await import('@playwright/test');
    const anon = await request.newContext();
    try {
      const res = await anon.get(url.toString());
      expect([400, 403]).toContain(res.status());
    } finally {
      await anon.dispose();
    }
  });

  test('revoked share returns 403 on same URL', async () => {
    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    const shareRes = await hr.ctx.post(
      `/api/v1/admin/timesheet/exports/${encodeURIComponent(exportId!)}/shares`,
      {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
        data: { ttlHours: 24 },
      },
    );
    const share = (await shareRes.json()) as { id: string; url: string };

    const revoke = await hr.ctx.post(
      `/api/v1/admin/timesheet/exports/${encodeURIComponent(exportId!)}/shares/${encodeURIComponent(share.id)}/revoke`,
      { headers: { Authorization: `Bearer ${hr.accessToken}` } },
    );
    expect(revoke.status()).toBe(204);
    await hr.ctx.dispose();

    const { request } = await import('@playwright/test');
    const anon = await request.newContext();
    try {
      const res = await anon.get(share.url);
      expect(res.status()).toBe(403);
    } finally {
      await anon.dispose();
    }
  });

  test('EMPLOYEE cannot mint a share (403)', async () => {
    const emp = await login(
      SEED_USERS.employee.email,
      SEED_USERS.employee.password,
    );
    const res = await emp.ctx.post(
      `/api/v1/admin/timesheet/exports/${encodeURIComponent(exportId!)}/shares`,
      {
        headers: { Authorization: `Bearer ${emp.accessToken}` },
        data: { ttlHours: 24 },
      },
    );
    expect(res.status()).toBe(403);
    await emp.ctx.dispose();
  });
});
