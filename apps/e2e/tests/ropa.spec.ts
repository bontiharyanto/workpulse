import { expect, test, type APIRequestContext } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';

/**
 * Fase 31d — ROPA registry E2E (API-only).
 *
 * Flow: seed defaults → edit a DRAFT → submit-review → publish → confirm
 * previous PUBLISHED archives (via `new-version` fork) → export PDF + XLSX
 * → audit log contains `ROPA_EXPORTED` with a payload SHA-256.
 *
 * Tests run serially because they share tenant state — seed is idempotent
 * so re-runs against a persisted DB do not blow up, but sequencing keeps
 * assertions crisp.
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

test('HR can seed defaults idempotently', async () => {
  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
  try {
    const seed1 = await hr.ctx.post('/api/v1/admin/ropa/seed-defaults', {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
      data: {},
    });
    expect([200, 201]).toContain(seed1.status());
    const body1 = (await seed1.json()) as { created: string[]; skipped: string[] };
    expect(body1.created.length + body1.skipped.length).toBe(6);

    // Re-run — all should be skipped.
    const seed2 = await hr.ctx.post('/api/v1/admin/ropa/seed-defaults', {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
      data: {},
    });
    expect(seed2.status()).toBeLessThan(300);
    const body2 = (await seed2.json()) as { created: string[]; skipped: string[] };
    expect(body2.created).toEqual([]);
    expect(body2.skipped.length).toBe(6);
  } finally {
    await hr.ctx.dispose();
  }
});

test('non-HR is forbidden from listing', async () => {
  const emp = await login(SEED_USERS.employee.email, SEED_USERS.employee.password);
  try {
    const res = await emp.ctx.get('/api/v1/admin/ropa/activities', {
      headers: { Authorization: `Bearer ${emp.accessToken}` },
    });
    expect([401, 403]).toContain(res.status());
  } finally {
    await emp.ctx.dispose();
  }
});

test('DPO can DRAFT → REVIEW → PUBLISH one activity', async () => {
  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
  try {
    const listRes = await hr.ctx.get('/api/v1/admin/ropa/activities', {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
    });
    expect(listRes.status()).toBe(200);
    const items = (await listRes.json()) as Array<{
      activityId: string;
      slug: string;
      currentVersion: { id: string; status: string } | null;
      draftVersion: { id: string; status: string } | null;
    }>;
    // Pick an activity that has a DRAFT and no current published — the
    // first fresh seed run guarantees at least one such row unless a
    // previous test-suite run already published everything, in which
    // case we fork a new draft via the `new-version` endpoint.
    let target = items.find((i) => i.draftVersion && !i.currentVersion);
    let activityId: string;
    let versionId: string;
    if (target && target.draftVersion) {
      activityId = target.activityId;
      versionId = target.draftVersion.id;
    } else {
      // Fork a new DRAFT from the first PUBLISHED activity.
      target = items.find((i) => i.currentVersion);
      if (!target) throw new Error('no seeded activities to work with');
      activityId = target.activityId;
      const fork = await hr.ctx.post(`/api/v1/admin/ropa/activities/${activityId}/new-version`, {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
        data: {},
      });
      expect([200, 201]).toContain(fork.status());
      const forked = (await fork.json()) as { id: string };
      versionId = forked.id;
    }

    // Patch → edit one field.
    const patch = await hr.ctx.patch(
      `/api/v1/admin/ropa/activities/${activityId}/versions/${versionId}`,
      {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
        data: {
          retentionPeriod: 'Masa kerja + 3 tahun (kustom tenant).',
        },
      },
    );
    expect(patch.status()).toBe(200);
    const patched = (await patch.json()) as { retentionPeriod: string };
    expect(patched.retentionPeriod).toContain('kustom tenant');

    // Submit review.
    const sub = await hr.ctx.post(
      `/api/v1/admin/ropa/activities/${activityId}/versions/${versionId}/submit-review`,
      {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
        data: {},
      },
    );
    expect(sub.status()).toBe(200);
    const subBody = (await sub.json()) as { status: string };
    expect(subBody.status).toBe('REVIEW');

    // Publish.
    const pub = await hr.ctx.post(
      `/api/v1/admin/ropa/activities/${activityId}/versions/${versionId}/publish`,
      {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
        data: {},
      },
    );
    expect(pub.status()).toBe(200);
    const pubBody = (await pub.json()) as { status: string; publishedAt: string };
    expect(pubBody.status).toBe('PUBLISHED');
    expect(pubBody.publishedAt).toBeTruthy();

    // Patch on PUBLISHED must fail.
    const badPatch = await hr.ctx.patch(
      `/api/v1/admin/ropa/activities/${activityId}/versions/${versionId}`,
      {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
        data: { retentionPeriod: 'ubah lagi' },
      },
    );
    expect(badPatch.status()).toBe(409);
    const err = (await badPatch.json()) as { code?: string };
    expect(err.code).toBe('ROPA_NOT_EDITABLE');
  } finally {
    await hr.ctx.dispose();
  }
});

test('publish from DRAFT (skipping REVIEW) returns 409', async () => {
  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
  try {
    const items = (await (
      await hr.ctx.get('/api/v1/admin/ropa/activities', {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
      })
    ).json()) as Array<{
      activityId: string;
      draftVersion: { id: string; status: string } | null;
      currentVersion: { id: string } | null;
    }>;
    let target = items.find((i) => i.draftVersion && !i.currentVersion);
    let activityId: string;
    let versionId: string;
    if (target && target.draftVersion) {
      activityId = target.activityId;
      versionId = target.draftVersion.id;
    } else {
      // Fork a DRAFT.
      target = items.find((i) => i.currentVersion);
      if (!target) throw new Error('no seeded activities to work with');
      activityId = target.activityId;
      const fork = await hr.ctx.post(`/api/v1/admin/ropa/activities/${activityId}/new-version`, {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
        data: {},
      });
      const body = (await fork.json()) as { id: string };
      versionId = body.id;
    }

    const res = await hr.ctx.post(
      `/api/v1/admin/ropa/activities/${activityId}/versions/${versionId}/publish`,
      {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
        data: {},
      },
    );
    expect(res.status()).toBe(409);
    const err = (await res.json()) as { code?: string };
    expect(err.code).toBe('ROPA_ILLEGAL_TRANSITION');
  } finally {
    await hr.ctx.dispose();
  }
});

test('HR can export PDF + XLSX; both audited with SHA-256', async () => {
  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
  try {
    const pdf = await hr.ctx.get('/api/v1/admin/ropa/export.pdf', {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
    });
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    const pdfHash = pdf.headers()['x-payload-sha256'];
    expect(pdfHash).toMatch(/^[0-9a-f]{64}$/);
    const pdfBytes = await pdf.body();
    // pdfkit magic number %PDF
    expect(pdfBytes.slice(0, 4).toString('utf-8')).toBe('%PDF');
    expect(pdfBytes.byteLength).toBeGreaterThan(500);

    const xlsx = await hr.ctx.get('/api/v1/admin/ropa/export.xlsx', {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
    });
    expect(xlsx.status()).toBe(200);
    expect(xlsx.headers()['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const xlsxHash = xlsx.headers()['x-payload-sha256'];
    expect(xlsxHash).toMatch(/^[0-9a-f]{64}$/);
    const xlsxBytes = await xlsx.body();
    // XLSX = ZIP; magic bytes PK\x03\x04.
    expect(xlsxBytes[0]).toBe(0x50);
    expect(xlsxBytes[1]).toBe(0x4b);

    // Audit log surfaces the export event.
    const audit = await hr.ctx.get('/api/v1/admin/audit-log?action=ROPA_EXPORTED&limit=5', {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
    });
    expect(audit.status()).toBe(200);
    const auditBody = (await audit.json()) as {
      rows: Array<{ action: string; afterJson: { sha256: string; format: string } }>;
    };
    const formats = new Set(auditBody.rows.map((i) => i.afterJson.format));
    expect(formats.has('PDF')).toBe(true);
    expect(formats.has('XLSX')).toBe(true);
    const hashes = auditBody.rows.map((i) => i.afterJson.sha256);
    expect(hashes).toContain(pdfHash);
    expect(hashes).toContain(xlsxHash);
  } finally {
    await hr.ctx.dispose();
  }
});
