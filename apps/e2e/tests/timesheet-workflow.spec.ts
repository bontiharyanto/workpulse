import { expect, test, type APIRequestContext } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';

/**
 * Fase 32b — timesheet submission workflow.
 *
 * Verifies:
 *   - Employee cannot submit while the period still has days remaining.
 *   - Happy path: DRAFT → PENDING_SUPERVISOR → PENDING_HR → APPROVED.
 *   - Supervisor rejection requires a note and lands the row in REJECTED.
 *   - After a rejection the employee can re-submit; the row goes back
 *     to PENDING_SUPERVISOR (no data was lost).
 *   - Non-team supervisors cannot decide on someone else's timesheet.
 *   - APPROVED rows are locked from regenerate: HR "generate" leaves
 *     them alone and returns them under `timesheetsSkippedApproved`.
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

async function generateForPastMonth(
  email: string,
): Promise<{ periodId: string; timesheetsGenerated: number }> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    // Anchor at the 15th of the *previous* calendar month — the whole
    // period ends well before "today", so a submit is legal.
    const now = new Date();
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    const res = await ctx.post('/api/v1/test-support/timesheet/generate', {
      data: { email, at: at.toISOString() },
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

async function findMyTimesheet(
  ctx: APIRequestContext,
  token: string,
  periodId: string,
): Promise<{ id: string; status: string } | null> {
  const res = await ctx.get(`/api/v1/me/timesheet?limit=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  const items = (await res.json()) as Array<{
    id: string;
    periodId: string;
    status: string;
  }>;
  return items.find((t) => t.periodId === periodId) ?? null;
}

async function readAdminTimesheet(
  ctx: APIRequestContext,
  token: string,
  id: string,
): Promise<{ id: string; status: string; rejectionReason: string | null }> {
  const res = await ctx.get(`/api/v1/admin/timesheet/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as {
    id: string;
    status: string;
    rejectionReason: string | null;
  };
}

test.describe('Timesheet workflow — happy path & rejections', () => {
  test.beforeAll(async () => {
    // Consent-prune keeps the HR account from getting bounced by the
    // ConsentAcceptedGuard when we drive test-support routes.
    await pruneConsent(SEED_USERS.hr.email);
    await pruneTimesheets(SEED_USERS.hr.email);
  });

  test('submit → supervisor approve → HR approve locks the row', async () => {
    const gen = await generateForPastMonth(SEED_USERS.hr.email);
    expect(gen.timesheetsGenerated).toBeGreaterThan(0);

    // 1. Employee submits.
    const emp = await login(SEED_USERS.employee.email, SEED_USERS.employee.password);
    const mine = await findMyTimesheet(emp.ctx, emp.accessToken, gen.periodId);
    expect(mine, 'employee should own a timesheet in the generated period').toBeTruthy();
    expect(mine!.status).toBe('DRAFT');

    const submitRes = await emp.ctx.post(
      `/api/v1/me/timesheet/${encodeURIComponent(mine!.id)}/submit`,
      { headers: { Authorization: `Bearer ${emp.accessToken}` }, data: {} },
    );
    expect(submitRes.status()).toBe(204);
    await emp.ctx.dispose();

    // 2. Supervisor approves.
    const sup = await login(SEED_USERS.supervisor.email, SEED_USERS.supervisor.password);
    const afterSubmit = await readAdminTimesheet(sup.ctx, sup.accessToken, mine!.id);
    expect(afterSubmit.status).toBe('PENDING_SUPERVISOR');

    const supApprove = await sup.ctx.post(
      `/api/v1/admin/timesheet/${encodeURIComponent(mine!.id)}/decide`,
      {
        headers: { Authorization: `Bearer ${sup.accessToken}` },
        data: { action: 'SUPERVISOR_APPROVE' },
      },
    );
    expect(supApprove.status()).toBe(204);
    const afterSup = await readAdminTimesheet(sup.ctx, sup.accessToken, mine!.id);
    expect(afterSup.status).toBe('PENDING_HR');
    await sup.ctx.dispose();

    // 3. HR approves.
    const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
    const hrApprove = await hr.ctx.post(
      `/api/v1/admin/timesheet/${encodeURIComponent(mine!.id)}/decide`,
      {
        headers: { Authorization: `Bearer ${hr.accessToken}` },
        data: { action: 'HR_APPROVE' },
      },
    );
    expect(hrApprove.status()).toBe(204);
    const afterHr = await readAdminTimesheet(hr.ctx, hr.accessToken, mine!.id);
    expect(afterHr.status).toBe('APPROVED');
    await hr.ctx.dispose();
  });

  test('reject without a note is 409; reject → resubmit → PENDING_SUPERVISOR', async () => {
    // Regenerate a fresh timesheet in an even older period so the
    // previously-APPROVED row from the prior test doesn't interfere.
    const { request } = await import('@playwright/test');
    const ctx = await request.newContext({ baseURL: API_URL });
    try {
      const now = new Date();
      const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 15));
      const genRes = await ctx.post('/api/v1/test-support/timesheet/generate', {
        data: { email: SEED_USERS.hr.email, at: at.toISOString() },
      });
      expect(genRes.ok()).toBeTruthy();
      var gen = (await genRes.json()) as { periodId: string };
    } finally {
      await ctx.dispose();
    }

    // Employee submits.
    const emp = await login(SEED_USERS.employee.email, SEED_USERS.employee.password);
    const mine = await findMyTimesheet(emp.ctx, emp.accessToken, gen.periodId);
    expect(mine).toBeTruthy();
    const submitRes = await emp.ctx.post(
      `/api/v1/me/timesheet/${encodeURIComponent(mine!.id)}/submit`,
      { headers: { Authorization: `Bearer ${emp.accessToken}` }, data: {} },
    );
    expect(submitRes.status()).toBe(204);
    await emp.ctx.dispose();

    const sup = await login(SEED_USERS.supervisor.email, SEED_USERS.supervisor.password);

    // Reject without note → 409.
    const emptyReject = await sup.ctx.post(
      `/api/v1/admin/timesheet/${encodeURIComponent(mine!.id)}/decide`,
      {
        headers: { Authorization: `Bearer ${sup.accessToken}` },
        data: { action: 'SUPERVISOR_REJECT' },
      },
    );
    expect(emptyReject.status()).toBe(409);

    // Reject with note.
    const goodReject = await sup.ctx.post(
      `/api/v1/admin/timesheet/${encodeURIComponent(mine!.id)}/decide`,
      {
        headers: { Authorization: `Bearer ${sup.accessToken}` },
        data: {
          action: 'SUPERVISOR_REJECT',
          note: 'Silakan tambahkan koreksi jam pulang tanggal 5.',
        },
      },
    );
    expect(goodReject.status()).toBe(204);
    const afterReject = await readAdminTimesheet(sup.ctx, sup.accessToken, mine!.id);
    expect(afterReject.status).toBe('REJECTED');
    expect(afterReject.rejectionReason).toContain('koreksi jam pulang');
    await sup.ctx.dispose();

    // Employee resubmits — row goes back to PENDING_SUPERVISOR.
    const emp2 = await login(SEED_USERS.employee.email, SEED_USERS.employee.password);
    const resubmit = await emp2.ctx.post(
      `/api/v1/me/timesheet/${encodeURIComponent(mine!.id)}/submit`,
      { headers: { Authorization: `Bearer ${emp2.accessToken}` }, data: {} },
    );
    expect(resubmit.status()).toBe(204);
    await emp2.ctx.dispose();

    const sup2 = await login(SEED_USERS.supervisor.email, SEED_USERS.supervisor.password);
    const afterResubmit = await readAdminTimesheet(sup2.ctx, sup2.accessToken, mine!.id);
    expect(afterResubmit.status).toBe('PENDING_SUPERVISOR');
    expect(afterResubmit.rejectionReason).toBeNull();
    await sup2.ctx.dispose();
  });

  test('employee cannot submit before periodEnd (409)', async () => {
    // Current-month timesheet: periodEnd = last day of this month, so
    // "today" is <= periodEnd for the entire month.
    const { request } = await import('@playwright/test');
    const ctx = await request.newContext({ baseURL: API_URL });
    try {
      const genRes = await ctx.post('/api/v1/test-support/timesheet/generate', {
        data: { email: SEED_USERS.hr.email },
      });
      expect(genRes.ok()).toBeTruthy();
      var gen = (await genRes.json()) as { periodId: string };
    } finally {
      await ctx.dispose();
    }

    const emp = await login(SEED_USERS.employee.email, SEED_USERS.employee.password);
    const mine = await findMyTimesheet(emp.ctx, emp.accessToken, gen.periodId);
    expect(mine).toBeTruthy();

    // The current-month period should still be open; the submit must fail.
    const now = new Date();
    const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    if (endOfMonth.getTime() <= now.getTime()) {
      // Test run happens to be on the very last day of the month with
      // some slack; skip rather than assert a false negative.
      test.skip();
    }

    const submitRes = await emp.ctx.post(
      `/api/v1/me/timesheet/${encodeURIComponent(mine!.id)}/submit`,
      { headers: { Authorization: `Bearer ${emp.accessToken}` }, data: {} },
    );
    expect(submitRes.status()).toBe(409);
    await emp.ctx.dispose();
  });

  test('HR generate skips users whose timesheet is APPROVED', async () => {
    // Look up the previously-approved timesheet from test 1 (same
    // periodId — one month back) and prove a re-generate now skips it.
    const now = new Date();
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));

    const { request } = await import('@playwright/test');
    const ctx = await request.newContext({ baseURL: API_URL });
    try {
      const genRes = await ctx.post('/api/v1/test-support/timesheet/generate', {
        data: { email: SEED_USERS.hr.email, at: at.toISOString() },
      });
      expect(genRes.ok()).toBeTruthy();
      const body = (await genRes.json()) as {
        timesheetsGenerated: number;
        timesheetsSkippedApproved: number;
      };
      expect(body.timesheetsSkippedApproved).toBeGreaterThan(0);
    } finally {
      await ctx.dispose();
    }
  });

  test('a non-team supervisor cannot decide on someone else’s timesheet', async () => {
    // Use SUPER_ADMIN's timesheet: it lives in the HR queue but is NOT
    // supervised by the regular team-lead supervisor.
    // First, generate + submit as super-admin owner.
    const now = new Date();
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 15));
    const { request } = await import('@playwright/test');
    const ctx = await request.newContext({ baseURL: API_URL });
    try {
      const genRes = await ctx.post('/api/v1/test-support/timesheet/generate', {
        data: { email: SEED_USERS.hr.email, at: at.toISOString() },
      });
      expect(genRes.ok()).toBeTruthy();
      var gen = (await genRes.json()) as { periodId: string };
    } finally {
      await ctx.dispose();
    }

    // Log in as admin, find own timesheet, submit it.
    const admin = await login(SEED_USERS.admin.email, SEED_USERS.admin.password);
    const adminList = await admin.ctx.get('/api/v1/me/timesheet?limit=50', {
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    });
    const adminItems = (await adminList.json()) as Array<{
      id: string;
      periodId: string;
      status: string;
    }>;
    const adminOwn = adminItems.find((t) => t.periodId === gen.periodId);
    expect(adminOwn).toBeTruthy();

    const submit = await admin.ctx.post(
      `/api/v1/me/timesheet/${encodeURIComponent(adminOwn!.id)}/submit`,
      { headers: { Authorization: `Bearer ${admin.accessToken}` }, data: {} },
    );
    expect(submit.status()).toBe(204);
    await admin.ctx.dispose();

    // A regular team-lead supervisor should NOT be able to approve.
    // The row won't even be in their scoped list, so /decide returns
    // 404 (visibility gate) rather than 403.
    const sup = await login(SEED_USERS.supervisor.email, SEED_USERS.supervisor.password);
    const foreign = await sup.ctx.post(
      `/api/v1/admin/timesheet/${encodeURIComponent(adminOwn!.id)}/decide`,
      {
        headers: { Authorization: `Bearer ${sup.accessToken}` },
        data: { action: 'SUPERVISOR_APPROVE' },
      },
    );
    expect([403, 404]).toContain(foreign.status());
    await sup.ctx.dispose();
  });
});
