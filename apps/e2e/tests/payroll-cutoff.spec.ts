import { expect, test } from '@playwright/test';

import { authenticateApi } from './helpers/api';

/**
 * Payroll cutoff enforcement (see ADR-0010).
 *
 * We assert the invariant at the HTTP boundary:
 *
 *   1. HR sets `payrollLockedUntil` via `PATCH /admin/company`.
 *   2. HR trying to `POST /attendance/absence` on a date `<=` cutoff is
 *      refused with `409 CONFLICT` and `code: 'PAYROLL_LOCKED'`.
 *   3. `SUPER_ADMIN` on the same call succeeds (emergency-override lane).
 *   4. Deletion is symmetric — HR refused, Super Admin allowed.
 *
 * The spec cleans up after itself (drops the cutoff back to null and
 * removes any AbsenceRecord it created) so subsequent runs stay green.
 *
 * Serial — every test operates on the same tenant's cutoff column, and
 * one test's tear-down is the next test's precondition.
 */
test.describe.configure({ mode: 'serial' });

/**
 * Locked date used across the spec. Must be:
 *   * At least a week in the past to sidestep the auto-scheduler entirely.
 *   * Different from the value in `attendance-manual-absence.spec.ts`
 *     (`2026-07-01`) so a partial parallelization doesn't collide.
 */
const LOCKED_DATE = '2026-06-15';
const CUTOFF_DATE = '2026-06-30';

async function findTargetUserId(
  api: import('@playwright/test').APIRequestContext,
): Promise<string> {
  const res = await api.get('/api/v1/attendance/team/today');
  expect(res.ok()).toBeTruthy();
  const roster = (await res.json()) as ReadonlyArray<{
    userId: string;
    email: string;
  }>;
  const employee = roster.find((r) => r.email === 'employee@acme.test');
  if (!employee) throw new Error('payroll-cutoff: seed user employee@acme.test not found');
  return employee.userId;
}

async function setCutoff(
  api: import('@playwright/test').APIRequestContext,
  value: string | null,
): Promise<void> {
  const res = await api.patch('/api/v1/admin/company', {
    data: { payrollLockedUntil: value },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = (await res.json()) as { payrollLockedUntil: string | null };
  expect(body.payrollLockedUntil).toBe(value);
}

async function cleanupAbsence(
  api: import('@playwright/test').APIRequestContext,
  userId: string,
  workDate: string,
): Promise<void> {
  const res = await api.get(`/api/v1/attendance/team/today?date=${workDate}`);
  if (!res.ok()) return;
  const rows = (await res.json()) as ReadonlyArray<{
    userId: string;
    absenceRecordId: string | null;
  }>;
  const existing = rows.find((r) => r.userId === userId)?.absenceRecordId ?? null;
  if (existing) {
    // Super admin can always delete regardless of cutoff, which is
    // what we want during clean-up.
    const admin = await authenticateApi('admin');
    await admin.api.delete(`/api/v1/attendance/absence/${existing}`);
    await admin.api.dispose();
  }
}

test.beforeAll(async () => {
  // Always start from a clean cutoff state.
  const hr = await authenticateApi('hr');
  await setCutoff(hr.api, null);
  await hr.api.dispose();
});

test.afterAll(async () => {
  const hr = await authenticateApi('hr');
  await setCutoff(hr.api, null);
  await hr.api.dispose();
});

test('HR: PATCH /admin/company can set + clear payrollLockedUntil', async () => {
  const { api } = await authenticateApi('hr');
  await setCutoff(api, CUTOFF_DATE);

  const readBack = await api.get('/api/v1/admin/company');
  const cfg = (await readBack.json()) as { payrollLockedUntil: string | null };
  expect(cfg.payrollLockedUntil).toBe(CUTOFF_DATE);

  await setCutoff(api, null);
  await api.dispose();
});

test('HR: rejects malformed payrollLockedUntil with 400', async () => {
  const { api } = await authenticateApi('hr');
  const res = await api.patch('/api/v1/admin/company', {
    data: { payrollLockedUntil: 'not-a-date' },
  });
  expect(res.status()).toBe(400);
  await api.dispose();
});

test('HR: cannot mark absent inside a frozen period (409 PAYROLL_LOCKED)', async () => {
  const hr = await authenticateApi('hr');
  const targetUserId = await findTargetUserId(hr.api);
  await cleanupAbsence(hr.api, targetUserId, LOCKED_DATE);
  await setCutoff(hr.api, CUTOFF_DATE);

  const res = await hr.api.post('/api/v1/attendance/absence', {
    data: { userId: targetUserId, workDate: LOCKED_DATE, reason: 'attempt during lock' },
  });
  expect(res.status()).toBe(409);
  const body = (await res.json()) as {
    code?: string;
    cutoffDate?: string;
    message?: string;
  };
  expect(body.code).toBe('PAYROLL_LOCKED');
  expect(body.cutoffDate).toBe(CUTOFF_DATE);

  await setCutoff(hr.api, null);
  await hr.api.dispose();
});

test('SUPER_ADMIN: emergency override lets us mark absent inside a frozen period', async () => {
  const hr = await authenticateApi('hr');
  const targetUserId = await findTargetUserId(hr.api);
  await cleanupAbsence(hr.api, targetUserId, LOCKED_DATE);
  await setCutoff(hr.api, CUTOFF_DATE);
  await hr.api.dispose();

  const admin = await authenticateApi('admin');
  const createRes = await admin.api.post('/api/v1/attendance/absence', {
    data: { userId: targetUserId, workDate: LOCKED_DATE, reason: 'SUPER_ADMIN override' },
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as { id: string; source: string };
  expect(created.source).toBe('MANUAL_HR');

  // And Super Admin can DELETE it too, symmetric on the lock bypass.
  const delRes = await admin.api.delete(`/api/v1/attendance/absence/${created.id}`);
  expect(delRes.status()).toBe(204);

  // Cleanup
  const cleanup = await authenticateApi('hr');
  await setCutoff(cleanup.api, null);
  await cleanup.api.dispose();
  await admin.api.dispose();
});

test('HR: cannot delete an AbsenceRecord inside a frozen period', async () => {
  // Precondition: create the absence in an unlocked state...
  const hr = await authenticateApi('hr');
  const targetUserId = await findTargetUserId(hr.api);
  await cleanupAbsence(hr.api, targetUserId, LOCKED_DATE);
  await setCutoff(hr.api, null);

  const createRes = await hr.api.post('/api/v1/attendance/absence', {
    data: { userId: targetUserId, workDate: LOCKED_DATE },
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as { id: string };

  // ...then close payroll and try to delete.
  await setCutoff(hr.api, CUTOFF_DATE);
  const delRes = await hr.api.delete(`/api/v1/attendance/absence/${created.id}`);
  expect(delRes.status()).toBe(409);
  const body = (await delRes.json()) as { code?: string };
  expect(body.code).toBe('PAYROLL_LOCKED');

  // Cleanup — Super Admin can still delete.
  const admin = await authenticateApi('admin');
  await admin.api.delete(`/api/v1/attendance/absence/${created.id}`);
  await admin.api.dispose();

  await setCutoff(hr.api, null);
  await hr.api.dispose();
});

test('HR: dates strictly AFTER the cutoff are still writable', async () => {
  const hr = await authenticateApi('hr');
  const targetUserId = await findTargetUserId(hr.api);
  // A date one day past the cutoff — outside the lock.
  const unlockedDate = '2026-07-01';
  await cleanupAbsence(hr.api, targetUserId, unlockedDate);
  await setCutoff(hr.api, CUTOFF_DATE);

  const createRes = await hr.api.post('/api/v1/attendance/absence', {
    data: { userId: targetUserId, workDate: unlockedDate },
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as { id: string };

  // Cleanup — HR can still delete a post-cutoff row.
  const delRes = await hr.api.delete(`/api/v1/attendance/absence/${created.id}`);
  expect(delRes.status()).toBe(204);

  await setCutoff(hr.api, null);
  await hr.api.dispose();
});
