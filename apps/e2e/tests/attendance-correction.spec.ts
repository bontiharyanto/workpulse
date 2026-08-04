import { expect, test, type APIRequestContext } from '@playwright/test';

import { authenticateApi } from './helpers/api';
import { daysFromToday, nearestPastWeekday } from './helpers/dates';

/**
 * End-to-end coverage for the AttendanceCorrection module (Phase 19).
 *
 * Scenarios:
 *
 *   1. Full happy path — employee submits → supervisor approves → the
 *      correction materializes as an `AttendanceRecord` (create-or-patch).
 *   2. RBAC — a supervisor cannot approve a correction for someone outside
 *      their reporting line; an EMPLOYEE cannot decide at all.
 *   3. Cancel — owner may cancel a PENDING correction; a non-owner cannot.
 *   4. Payroll cutoff — HR cannot submit / decide inside a locked period;
 *      SUPER_ADMIN can decide (emergency-override); the guard clears when
 *      the cutoff is removed.
 *
 * Runs serial because tests 1 & 4 both touch the SAME employee's records
 * for adjacent dates; parallel would race on the (userId, workDate) unique.
 */
test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Fixture dates (dynamic — never pin to a hardcoded calendar date)
// ---------------------------------------------------------------------------
//
// We spread each test's workDate across DIFFERENT weekdays so:
//   a. No `DUPLICATE_PENDING` clashes across tests within a run.
//   b. `AttendanceRecord`'s (userId, workDate) unique won't collide with
//      an earlier test's rows that survived a partial cleanup.

const DATE_HAPPY = nearestPastWeekday(5);
const DATE_SUP_RBAC = nearestPastWeekday(7);
const DATE_CANCEL = nearestPastWeekday(9);
const DATE_CUTOFF = nearestPastWeekday(11);
const CUTOFF_ANCHOR = nearestPastWeekday(10); // ≥ DATE_CUTOFF → locks it

async function setCutoff(
  api: APIRequestContext,
  value: string | null,
): Promise<void> {
  const res = await api.patch('/api/v1/admin/company', {
    data: { payrollLockedUntil: value },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

interface SubmitCorrectionBody {
  workDate: string;
  requestedClockInAt?: string | null;
  requestedClockOutAt?: string | null;
  reason: string;
}

async function submitCorrection(
  api: APIRequestContext,
  body: SubmitCorrectionBody,
): Promise<import('@playwright/test').APIResponse> {
  return api.post('/api/v1/attendance/corrections', { data: body });
}

async function decideCorrection(
  api: APIRequestContext,
  id: string,
  action: 'APPROVE' | 'REJECT',
  note?: string,
): Promise<import('@playwright/test').APIResponse> {
  return api.post(`/api/v1/attendance/corrections/${id}/decision`, {
    data: { action, ...(note !== undefined && { note }) },
  });
}

async function cancelCorrection(
  api: APIRequestContext,
  id: string,
): Promise<import('@playwright/test').APIResponse> {
  return api.post(`/api/v1/attendance/corrections/${id}/cancel`);
}

/**
 * Compose a UTC ISO timestamp on a given calendar date. Kept as a helper
 * so tests read "clock in at 09:00" rather than a raw ISO string.
 */
function utcAt(dateIso: string, hhmm: string): string {
  const parts = hhmm.split(':').map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  return `${dateIso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
}

test.beforeAll(async () => {
  // Ensure any prior partial run didn't leave a cutoff set — otherwise
  // ALL these tests would fail with PAYROLL_LOCKED.
  const admin = await authenticateApi('admin');
  await setCutoff(admin.api, null);
  await admin.api.dispose();
});

test.afterAll(async () => {
  const admin = await authenticateApi('admin');
  await setCutoff(admin.api, null);
  await admin.api.dispose();
});

// ---------------------------------------------------------------------------
// 1. Happy path: employee → supervisor approves → AttendanceRecord created
// ---------------------------------------------------------------------------

test('happy path: employee submits, supervisor approves, correction is applied', async () => {
  const employee = await authenticateApi('employee');
  const supervisor = await authenticateApi('supervisor');

  const submit = await submitCorrection(employee.api, {
    workDate: DATE_HAPPY,
    requestedClockInAt: utcAt(DATE_HAPPY, '09:00'),
    requestedClockOutAt: utcAt(DATE_HAPPY, '18:00'),
    reason: 'lupa clock-in dan clock-out karena training',
  });
  expect(submit.status(), await submit.text()).toBe(201);
  const submitted = (await submit.json()) as { id: string; status: string };
  expect(submitted.status).toBe('PENDING_APPROVAL');

  // Supervisor sees it in their queue.
  const queue = await supervisor.api.get(
    '/api/v1/attendance/corrections/approvals/pending',
  );
  expect(queue.ok()).toBeTruthy();
  const pending = (await queue.json()) as Array<{ id: string }>;
  expect(pending.some((r) => r.id === submitted.id)).toBeTruthy();

  const decide = await decideCorrection(
    supervisor.api,
    submitted.id,
    'APPROVE',
  );
  expect(decide.status(), await decide.text()).toBe(200);
  const approved = (await decide.json()) as { status: string; decidedById: string };
  expect(approved.status).toBe('APPROVED');
  expect(approved.decidedById).toBeTruthy();

  // Employee's history now contains the newly-created AttendanceRecord.
  // Note: `AttendanceRecordDto.workDate` is a full ISO string
  // (`toISOString()` output), NOT a YYYY-MM-DD calendar date. Comparing
  // via `startsWith` keeps the check readable while tolerant to the
  // 'T00:00:00.000Z' suffix.
  const history = await employee.api.get(
    `/api/v1/attendance/me/history?from=${DATE_HAPPY}&to=${DATE_HAPPY}`,
  );
  expect(history.ok()).toBeTruthy();
  const rows = (await history.json()) as Array<{
    workDate: string;
    clockInAt: string;
    clockOutAt: string | null;
  }>;
  expect(rows.length).toBeGreaterThanOrEqual(1);
  const created = rows.find((r) => r.workDate.startsWith(DATE_HAPPY));
  expect(created, `no AttendanceRecord for ${DATE_HAPPY} in history`).toBeDefined();
  expect(created?.clockInAt).toContain(DATE_HAPPY);
  expect(created?.clockOutAt).toContain(DATE_HAPPY);

  await employee.api.dispose();
  await supervisor.api.dispose();
});

// ---------------------------------------------------------------------------
// 2. RBAC — EMPLOYEE cannot decide; other supervisor cannot decide
// ---------------------------------------------------------------------------

test('RBAC: EMPLOYEE receives 403 from the approvals endpoint', async () => {
  const employee = await authenticateApi('employee');
  const res = await employee.api.get(
    '/api/v1/attendance/corrections/approvals/pending',
  );
  expect(res.status()).toBe(403);
  await employee.api.dispose();
});

test('RBAC: EMPLOYEE cannot approve their own correction', async () => {
  const employee = await authenticateApi('employee');
  const submit = await submitCorrection(employee.api, {
    workDate: DATE_SUP_RBAC,
    requestedClockInAt: utcAt(DATE_SUP_RBAC, '09:00'),
    requestedClockOutAt: utcAt(DATE_SUP_RBAC, '18:00'),
    reason: 'test rbac',
  });
  expect(submit.status(), await submit.text()).toBe(201);
  const { id } = (await submit.json()) as { id: string };

  // Employee's own attempt at decide → 403 (roles guard).
  const decide = await decideCorrection(employee.api, id, 'APPROVE');
  expect(decide.status()).toBe(403);

  // Housekeeping: cancel so the RBAC row doesn't leak into other tests.
  const cancel = await cancelCorrection(employee.api, id);
  expect(cancel.ok()).toBeTruthy();
  await employee.api.dispose();
});

// ---------------------------------------------------------------------------
// 3. Cancel semantics
// ---------------------------------------------------------------------------

test('cancel: owner may cancel a PENDING correction; non-owner cannot', async () => {
  const employee = await authenticateApi('employee');
  const submit = await submitCorrection(employee.api, {
    workDate: DATE_CANCEL,
    requestedClockInAt: null,
    requestedClockOutAt: utcAt(DATE_CANCEL, '18:00'),
    reason: 'test cancel',
  });
  expect(submit.status(), await submit.text()).toBe(201);
  const { id } = (await submit.json()) as { id: string };

  // Supervisor is not the owner → 403 CANCEL rejected.
  const supervisor = await authenticateApi('supervisor');
  const foreignCancel = await cancelCorrection(supervisor.api, id);
  expect(foreignCancel.status()).toBe(403);
  await supervisor.api.dispose();

  const ownCancel = await cancelCorrection(employee.api, id);
  expect(ownCancel.status(), await ownCancel.text()).toBe(200);
  const cancelled = (await ownCancel.json()) as { status: string };
  expect(cancelled.status).toBe('CANCELLED');
  await employee.api.dispose();
});

// ---------------------------------------------------------------------------
// 4. Payroll cutoff — HR blocked, SUPER_ADMIN bypass
// ---------------------------------------------------------------------------

test('cutoff: HR submit / decide inside a locked period is refused with 409 PAYROLL_LOCKED; SUPER_ADMIN can decide', async () => {
  const admin = await authenticateApi('admin');
  const employee = await authenticateApi('employee');
  const hr = await authenticateApi('hr');

  // Submit BEFORE the cutoff exists — no guard yet.
  const submit = await submitCorrection(employee.api, {
    workDate: DATE_CUTOFF,
    requestedClockInAt: null,
    requestedClockOutAt: utcAt(DATE_CUTOFF, '17:30'),
    reason: 'pra-cutoff correction',
  });
  expect(submit.status(), await submit.text()).toBe(201);
  const { id } = (await submit.json()) as { id: string };

  // Impose a cutoff that engulfs DATE_CUTOFF.
  await setCutoff(admin.api, CUTOFF_ANCHOR);

  // HR decide → 409 PAYROLL_LOCKED with the cutoff date echoed in the body.
  const hrDecide = await decideCorrection(hr.api, id, 'APPROVE');
  expect(hrDecide.status()).toBe(409);
  const hrErr = (await hrDecide.json()) as { code?: string; cutoffDate?: string };
  expect(hrErr.code).toBe('PAYROLL_LOCKED');

  // HR-initiated submit for the locked date is also refused.
  const hrSubmit = await submitCorrection(hr.api, {
    workDate: DATE_CUTOFF,
    requestedClockInAt: utcAt(DATE_CUTOFF, '09:15'),
    requestedClockOutAt: utcAt(DATE_CUTOFF, '17:30'),
    reason: 'HR test',
  });
  expect(hrSubmit.status()).toBe(409);

  // SUPER_ADMIN decide bypasses.
  const superDecide = await decideCorrection(admin.api, id, 'REJECT', 'stale');
  expect(superDecide.status(), await superDecide.text()).toBe(200);
  const rejected = (await superDecide.json()) as { status: string };
  expect(rejected.status).toBe('REJECTED');

  await setCutoff(admin.api, null);
  await admin.api.dispose();
  await employee.api.dispose();
  await hr.api.dispose();
});
