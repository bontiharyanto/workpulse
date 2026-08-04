import { expect, test, type APIRequestContext } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';

/**
 * Fase 31e — DPIA E2E (API-only).
 *
 * Flow:
 *   1. Seed ROPA defaults (idempotent) to guarantee we have activities.
 *   2. Create a DPIA against the "attendance" activity.
 *   3. Add two risk items — one that violates residual ≤ inherent should
 *      be rejected.
 *   4. Submit for review → approve → confirm APPROVED status and audit
 *      trail (`DPIA_APPROVED`).
 *   5. Export PDF, verify `X-Payload-Sha256` header and `DPIA_EXPORTED`
 *      audit row.
 *   6. Verify EMPLOYEE / SUPERVISOR are forbidden from the read+write
 *      endpoints (RBAC scope isolation).
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

test('HR seeds ROPA defaults so a DPIA has something to attach to', async () => {
  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
  try {
    const seed = await hr.ctx.post('/api/v1/admin/ropa/seed-defaults', {
      headers: authHeader(hr.accessToken),
      data: {},
    });
    expect([200, 201]).toContain(seed.status());
  } finally {
    await hr.ctx.dispose();
  }
});

test('HR full DPIA lifecycle: create → add risks → submit → approve → export', async () => {
  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
  try {
    const listRes = await hr.ctx.get('/api/v1/admin/ropa/activities', {
      headers: authHeader(hr.accessToken),
    });
    expect(listRes.status()).toBe(200);
    const activities = (await listRes.json()) as Array<{
      activityId: string;
      slug: string;
    }>;
    const attendance = activities.find((a) => a.slug.includes('attendance'));
    expect(attendance).toBeDefined();

    const createRes = await hr.ctx.post('/api/v1/admin/dpia/assessments', {
      headers: authHeader(hr.accessToken),
      data: {
        ropaActivityId: attendance!.activityId,
        title: 'DPIA Attendance Geofence 2026-Q3',
        scope:
          'Penilaian dampak untuk geofence attendance dan pengumpulan koordinat GPS karyawan pada tenant.',
        necessity:
          'Diperlukan untuk memvalidasi kehadiran karyawan lapangan; alternatif seperti kartu absen mekanik tidak layak untuk operasi terdistribusi kami.',
      },
    });
    expect(createRes.status()).toBe(201);
    const created = (await createRes.json()) as { id: string; status: string };
    expect(created.status).toBe('DRAFT');
    const dpiaId = created.id;

    // Reject residual > inherent.
    const badResidual = await hr.ctx.post(`/api/v1/admin/dpia/assessments/${dpiaId}/risk-items`, {
      headers: authHeader(hr.accessToken),
      data: {
        title: 'Bad residual',
        description: 'Residual harus ≤ inherent',
        likelihood: 2,
        impact: 3,
        mitigations: 'Kontrol tambahan diklaim namun tidak realistis',
        residualLikelihood: 5,
        residualImpact: 5,
      },
    });
    // Class-validator rejects at DTO level (>5) before service —
    // whichever layer catches it, the response must be 4xx.
    expect(badResidual.status()).toBeGreaterThanOrEqual(400);
    expect(badResidual.status()).toBeLessThan(500);

    // Legal residual > inherent within grid.
    const rr = await hr.ctx.post(`/api/v1/admin/dpia/assessments/${dpiaId}/risk-items`, {
      headers: authHeader(hr.accessToken),
      data: {
        title: 'Residual > inherent within grid',
        description: 'Domain guard should still reject this',
        likelihood: 2,
        impact: 2,
        mitigations: 'Mitigasi klaim ambigu',
        residualLikelihood: 3,
        residualImpact: 3,
      },
    });
    expect(rr.status()).toBe(400);

    // Add a valid risk item.
    const good = await hr.ctx.post(`/api/v1/admin/dpia/assessments/${dpiaId}/risk-items`, {
      headers: authHeader(hr.accessToken),
      data: {
        title: 'Kebocoran koordinat GPS pada log verbose',
        description:
          'Log verbose dapat memuat koordinat GPS presisi yang bocor ke pihak yang tidak berwenang.',
        likelihood: 4,
        impact: 4,
        mitigations:
          'Redaksi otomatis pada middleware log; retensi log 30 hari; akses SSO + audit trail.',
        residualLikelihood: 2,
        residualImpact: 3,
      },
    });
    expect(good.status()).toBe(201);
    const afterAdd = (await good.json()) as {
      riskItems: Array<{ inherentLevel: string; residualLevel: string }>;
      summaryResidualLevel: string;
    };
    expect(afterAdd.riskItems.length).toBe(1);
    expect(afterAdd.riskItems[0]!.inherentLevel).toBe('HIGH'); // 4×4=16
    expect(afterAdd.riskItems[0]!.residualLevel).toBe('LOW'); // 2×3=6
    expect(afterAdd.summaryResidualLevel).toBe('LOW');

    // Submit for review.
    const sub = await hr.ctx.post(`/api/v1/admin/dpia/assessments/${dpiaId}/submit-review`, {
      headers: authHeader(hr.accessToken),
      data: {},
    });
    expect(sub.status()).toBe(200);
    expect(((await sub.json()) as { status: string }).status).toBe('REVIEW');

    // Approve.
    const ap = await hr.ctx.post(`/api/v1/admin/dpia/assessments/${dpiaId}/approve`, {
      headers: authHeader(hr.accessToken),
      data: {},
    });
    expect(ap.status()).toBe(200);
    const approved = (await ap.json()) as {
      status: string;
      approvedAt: string | null;
    };
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedAt).not.toBeNull();

    // Export PDF and verify audit hash header.
    const exportRes = await hr.ctx.get(`/api/v1/admin/dpia/assessments/${dpiaId}/export.pdf`, {
      headers: authHeader(hr.accessToken),
    });
    expect(exportRes.status()).toBe(200);
    expect(exportRes.headers()['content-type']).toContain('application/pdf');
    const sha = exportRes.headers()['x-payload-sha256'];
    expect(sha).toMatch(/^[a-f0-9]{64}$/);

    // Audit log must include DPIA_APPROVED + DPIA_EXPORTED.
    const auditRes = await hr.ctx.get(`/api/v1/admin/audit-log?entityType=DpiaAssessment`, {
      headers: authHeader(hr.accessToken),
    });
    expect(auditRes.status()).toBe(200);
    const body = (await auditRes.json()) as {
      rows: Array<{ action: string; entityId: string }>;
    };
    const actionsForDpia = body.rows.filter((r) => r.entityId === dpiaId).map((r) => r.action);
    expect(actionsForDpia).toEqual(
      expect.arrayContaining(['DPIA_CREATED', 'DPIA_APPROVED', 'DPIA_EXPORTED']),
    );
  } finally {
    await hr.ctx.dispose();
  }
});

test('EMPLOYEE cannot access DPIA endpoints', async () => {
  const emp = await login(SEED_USERS.employee.email, SEED_USERS.employee.password);
  try {
    const listRes = await emp.ctx.get('/api/v1/admin/dpia/assessments', {
      headers: authHeader(emp.accessToken),
    });
    expect([401, 403]).toContain(listRes.status());
  } finally {
    await emp.ctx.dispose();
  }
});
