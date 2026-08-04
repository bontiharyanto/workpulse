import { expect, test } from '@playwright/test';

import { daysFromToday, nearestPastWeekday, toIsoDate } from './helpers/dates';
import { authenticateApi } from './helpers/api';

/**
 * Payroll cutoff enforcement for **leave** and **overtime** requests
 * (ADR-0010 follow-up).
 *
 * ADR-0010 established the invariant on `AbsenceRecord`; this spec extends
 * coverage to the two other user-mutable domains that write to closed
 * periods:
 *
 *   * `LeaveRequest` — submit / decide / cancel refuse anything whose
 *     `startDate <= Company.payrollLockedUntil`.
 *   * `OvertimeRequest` — submit / decide / cancel refuse anything whose
 *     `workDate <= Company.payrollLockedUntil`.
 *
 * Every mutation is verified twice — once as HR (blocked with
 * `409 PAYROLL_LOCKED`) and once as `SUPER_ADMIN` (emergency-override lane
 * succeeds). Requests targeting dates strictly AFTER the cutoff continue
 * to flow normally.
 *
 * Serial mode: `Company.payrollLockedUntil` is a tenant-wide column and
 * these tests all set/clear it; sequential ordering keeps them from
 * stomping on each other.
 */
test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Fixture dates
// ---------------------------------------------------------------------------
//
// We deliberately compute the dates dynamically (rather than pinning to
// e.g. `2026-06-15`) because the overtime module enforces a 14-day submit
// window against "today". A static date drift would silently start
// failing with `OUTSIDE_SUBMIT_WINDOW` a fortnight into the future.
//
// The LOCKED_DATE lands ~5 weekdays behind today; the CUTOFF is a day
// AFTER LOCKED_DATE so LOCKED_DATE is squarely inside the frozen range.
// The UNLOCKED_DATE sits a day after the cutoff — used to prove that
// the guard is scoped and not blanket "no writes ever".
const LOCKED_DATE = nearestPastWeekday(5); // e.g. Fri 5 business days ago
const CUTOFF_DATE = daysFromToday(-3);
const UNLOCKED_DATE = daysFromToday(-2);

async function setCutoff(
  api: import('@playwright/test').APIRequestContext,
  value: string | null,
): Promise<void> {
  const res = await api.patch('/api/v1/admin/company', {
    data: { payrollLockedUntil: value },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function getLeaveTypeId(
  api: import('@playwright/test').APIRequestContext,
): Promise<string> {
  const res = await api.get('/api/v1/leave/types');
  expect(res.ok(), await res.text()).toBeTruthy();
  const types = (await res.json()) as ReadonlyArray<{
    id: string;
    code: string;
    kind: string;
  }>;
  const annual = types.find((t) => t.kind === 'ANNUAL');
  if (!annual) throw new Error('payroll-cutoff: no ANNUAL leave type seeded');
  return annual.id;
}

/**
 * Submit a LeaveRequest as `who` for a specific date range. Returns the
 * response for the caller to assert on — some callers want the 201 body,
 * others want the 409 error surface.
 */
async function submitLeave(
  api: import('@playwright/test').APIRequestContext,
  leaveTypeId: string,
  startDate: string,
  endDate: string,
  reason: string,
): Promise<import('@playwright/test').APIResponse> {
  return api.post('/api/v1/leave', {
    data: { leaveTypeId, startDate, endDate, reason },
  });
}

async function submitOvertime(
  api: import('@playwright/test').APIRequestContext,
  workDate: string,
  hours: number,
  reason: string,
): Promise<import('@playwright/test').APIResponse> {
  return api.post('/api/v1/overtime', {
    data: { workDate, hours, reason },
  });
}

// Best-effort tear-down. Never throws — failures inside cleanup are logged
// via the assertion messages but don't mask a legitimate test failure.
test.beforeAll(async () => {
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
// Leave — submit / decide / cancel
// ---------------------------------------------------------------------------

test('leave: HR submit inside a frozen period is rejected with 409 PAYROLL_LOCKED', async () => {
  const hr = await authenticateApi('hr');
  await setCutoff(hr.api, CUTOFF_DATE);

  const leaveTypeId = await getLeaveTypeId(hr.api);
  const res = await submitLeave(
    hr.api,
    leaveTypeId,
    LOCKED_DATE,
    LOCKED_DATE,
    'e2e: cutoff-blocked submit',
  );
  expect(res.status()).toBe(409);
  const body = (await res.json()) as { code?: string; cutoffDate?: string };
  expect(body.code).toBe('PAYROLL_LOCKED');
  expect(body.cutoffDate).toBe(CUTOFF_DATE);

  await setCutoff(hr.api, null);
  await hr.api.dispose();
});

test('leave: SUPER_ADMIN can APPROVE a request that lands inside the cutoff (bypass on decide)', async () => {
  // SUPER_ADMIN is NOT authorized on `POST /leave` (submit is scoped to
  // EMPLOYEE / SUPERVISOR / HR_MANAGER) — so we exercise the bypass on
  // the decide path instead, which SUPER_ADMIN is a valid actor for at
  // both PENDING_SUPERVISOR and PENDING_HR stages.

  // 1. Employee submits pre-lock so the row exists at PENDING_SUPERVISOR.
  const hr0 = await authenticateApi('hr');
  await setCutoff(hr0.api, null);
  await hr0.api.dispose();

  const employee = await authenticateApi('employee');
  const leaveTypeId = await getLeaveTypeId(employee.api);
  const submitRes = await submitLeave(
    employee.api,
    leaveTypeId,
    LOCKED_DATE,
    LOCKED_DATE,
    'e2e: cutoff-bypass decide',
  );
  expect(submitRes.ok(), await submitRes.text()).toBeTruthy();
  const created = (await submitRes.json()) as { id: string };
  await employee.api.dispose();

  // 2. Close payroll → SUPER_ADMIN can still act on the row.
  const hr = await authenticateApi('hr');
  await setCutoff(hr.api, CUTOFF_DATE);
  await hr.api.dispose();

  const admin = await authenticateApi('admin');
  // REJECT keeps the balance mostly untouched (reservedDelta = -1, usedDelta = 0)
  // and leaves the row in a terminal state so re-runs stay clean.
  const decideRes = await admin.api.post(
    `/api/v1/leave/${created.id}/decision`,
    { data: { action: 'REJECT', note: 'e2e: super-admin bypass' } },
  );
  expect(decideRes.ok(), await decideRes.text()).toBeTruthy();
  await admin.api.dispose();

  const cleanup = await authenticateApi('hr');
  await setCutoff(cleanup.api, null);
  await cleanup.api.dispose();
});

test('leave: HR cannot approve a request whose startDate falls inside a later-imposed cutoff', async () => {
  // Realistic flow: employee submits pre-lock → HR tries to approve
  // after payroll close. The guard rejects HR's decide even though the
  // state machine would otherwise permit HR at PENDING_SUPERVISOR.
  const hr0 = await authenticateApi('hr');
  await setCutoff(hr0.api, null);
  await hr0.api.dispose();

  const employee = await authenticateApi('employee');
  const leaveTypeId = await getLeaveTypeId(employee.api);
  const submitRes = await submitLeave(
    employee.api,
    leaveTypeId,
    LOCKED_DATE,
    LOCKED_DATE,
    'e2e: cutoff-blocked decide',
  );
  expect(submitRes.ok(), await submitRes.text()).toBeTruthy();
  const created = (await submitRes.json()) as { id: string };
  await employee.api.dispose();

  // Close payroll AFTER submission → decide should now be refused.
  const hr = await authenticateApi('hr');
  await setCutoff(hr.api, CUTOFF_DATE);
  const decideRes = await hr.api.post(`/api/v1/leave/${created.id}/decision`, {
    data: { action: 'APPROVE' },
  });
  expect(decideRes.status()).toBe(409);
  const body = (await decideRes.json()) as { code?: string };
  expect(body.code).toBe('PAYROLL_LOCKED');
  await hr.api.dispose();

  // Cleanup — Super Admin bypass to reject and clear the balance hold.
  const admin = await authenticateApi('admin');
  const adminDecide = await admin.api.post(
    `/api/v1/leave/${created.id}/decision`,
    { data: { action: 'REJECT', note: 'cleanup' } },
  );
  expect(adminDecide.ok()).toBeTruthy();
  await admin.api.dispose();

  const cleanup = await authenticateApi('hr');
  await setCutoff(cleanup.api, null);
  await cleanup.api.dispose();
});

test('leave: employee cannot cancel a request that lands inside a locked period', async () => {
  // Employee submits (cutoff clear). HR closes payroll. Employee's cancel
  // must fail — the leave already committed a reservation inside a
  // closed period; the employee cannot silently release it.
  const hr = await authenticateApi('hr');
  await setCutoff(hr.api, null);
  await hr.api.dispose();

  const employee = await authenticateApi('employee');
  const leaveTypeId = await getLeaveTypeId(employee.api);
  const submitRes = await submitLeave(
    employee.api,
    leaveTypeId,
    LOCKED_DATE,
    LOCKED_DATE,
    'e2e: cutoff-blocked employee cancel',
  );
  expect(submitRes.ok(), await submitRes.text()).toBeTruthy();
  const created = (await submitRes.json()) as { id: string };

  const hr2 = await authenticateApi('hr');
  await setCutoff(hr2.api, CUTOFF_DATE);
  await hr2.api.dispose();

  const cancelRes = await employee.api.post(`/api/v1/leave/${created.id}/cancel`);
  expect(cancelRes.status()).toBe(409);
  const body = (await cancelRes.json()) as { code?: string };
  expect(body.code).toBe('PAYROLL_LOCKED');

  // Cleanup — reject via Super Admin (bypass).
  const admin = await authenticateApi('admin');
  await admin.api.post(`/api/v1/leave/${created.id}/decision`, {
    data: { action: 'REJECT', note: 'cleanup' },
  });
  await admin.api.dispose();

  const cleanup = await authenticateApi('hr');
  await setCutoff(cleanup.api, null);
  await cleanup.api.dispose();
  await employee.api.dispose();
});

test('leave: requests strictly AFTER the cutoff continue to flow normally', async () => {
  // Sanity: the guard must be scoped to the frozen range. A leave request
  // one day past the cutoff should submit + cancel cleanly for HR.
  const hr = await authenticateApi('hr');
  await setCutoff(hr.api, CUTOFF_DATE);
  const leaveTypeId = await getLeaveTypeId(hr.api);

  const submitRes = await submitLeave(
    hr.api,
    leaveTypeId,
    UNLOCKED_DATE,
    UNLOCKED_DATE,
    'e2e: post-cutoff still flows',
  );
  expect(submitRes.ok(), await submitRes.text()).toBeTruthy();
  const created = (await submitRes.json()) as { id: string };

  const cancelRes = await hr.api.post(`/api/v1/leave/${created.id}/cancel`);
  expect(cancelRes.ok()).toBeTruthy();

  await setCutoff(hr.api, null);
  await hr.api.dispose();
});

// ---------------------------------------------------------------------------
// Overtime — submit / decide / cancel
// ---------------------------------------------------------------------------

test('overtime: submit inside a frozen period is rejected with 409 PAYROLL_LOCKED', async () => {
  const hr = await authenticateApi('hr');
  await setCutoff(hr.api, CUTOFF_DATE);
  await hr.api.dispose();

  const employee = await authenticateApi('employee');
  const res = await submitOvertime(
    employee.api,
    LOCKED_DATE,
    2,
    'e2e: cutoff-blocked OT submit',
  );
  expect(res.status()).toBe(409);
  const body = (await res.json()) as { code?: string };
  expect(body.code).toBe('PAYROLL_LOCKED');
  await employee.api.dispose();

  const cleanup = await authenticateApi('hr');
  await setCutoff(cleanup.api, null);
  await cleanup.api.dispose();
});

test('overtime: SUPER_ADMIN can DECIDE a request whose workDate falls inside the cutoff', async () => {
  // SUPER_ADMIN is not in `@Roles` for `POST /overtime` (submit is
  // employee/supervisor/HR only) — so the bypass path is verified on
  // decide, where SUPER_ADMIN is a valid actor.

  // 1. Precondition: cutoff clear, employee submits.
  const hr0 = await authenticateApi('hr');
  await setCutoff(hr0.api, null);
  await hr0.api.dispose();

  const workDate = toIsoDate(offsetWeekday(LOCKED_DATE, -2));
  const employee = await authenticateApi('employee');
  const submitRes = await submitOvertime(
    employee.api,
    workDate,
    1,
    'e2e: cutoff-bypass OT decide',
  );
  expect(submitRes.ok(), await submitRes.text()).toBeTruthy();
  const created = (await submitRes.json()) as { id: string };
  await employee.api.dispose();

  // 2. Close payroll, then SUPER_ADMIN decides — should succeed.
  const hr = await authenticateApi('hr');
  await setCutoff(hr.api, CUTOFF_DATE);
  await hr.api.dispose();

  const admin = await authenticateApi('admin');
  const decideRes = await admin.api.post(
    `/api/v1/overtime/${created.id}/decision`,
    { data: { action: 'REJECT', note: 'e2e: super-admin bypass' } },
  );
  expect(decideRes.ok(), await decideRes.text()).toBeTruthy();
  await admin.api.dispose();

  const cleanup = await authenticateApi('hr');
  await setCutoff(cleanup.api, null);
  await cleanup.api.dispose();
});

test('overtime: HR cannot approve a request whose workDate later falls inside the cutoff', async () => {
  // Precondition: cutoff clear, employee submits an OT request.
  const hr0 = await authenticateApi('hr');
  await setCutoff(hr0.api, null);
  await hr0.api.dispose();

  const employee = await authenticateApi('employee');
  const workDate = toIsoDate(offsetWeekday(LOCKED_DATE, -4));
  const submitRes = await submitOvertime(
    employee.api,
    workDate,
    2,
    'e2e: cutoff-blocked OT decide',
  );
  expect(submitRes.ok(), await submitRes.text()).toBeTruthy();
  const created = (await submitRes.json()) as { id: string };
  await employee.api.dispose();

  // Close payroll → decision must now fail for HR.
  const hr = await authenticateApi('hr');
  await setCutoff(hr.api, CUTOFF_DATE);
  const decideRes = await hr.api.post(
    `/api/v1/overtime/${created.id}/decision`,
    { data: { action: 'APPROVE' } },
  );
  expect(decideRes.status()).toBe(409);
  const body = (await decideRes.json()) as { code?: string };
  expect(body.code).toBe('PAYROLL_LOCKED');
  await hr.api.dispose();

  // Cleanup — Super Admin can reject to release the row.
  const admin = await authenticateApi('admin');
  await admin.api.post(`/api/v1/overtime/${created.id}/decision`, {
    data: { action: 'REJECT' },
  });
  await admin.api.dispose();

  const cleanup = await authenticateApi('hr');
  await setCutoff(cleanup.api, null);
  await cleanup.api.dispose();
});

test('overtime: owner cannot cancel a request inside a locked period; SUPER_ADMIN can', async () => {
  const hr0 = await authenticateApi('hr');
  await setCutoff(hr0.api, null);
  await hr0.api.dispose();

  const employee = await authenticateApi('employee');
  const workDate = toIsoDate(offsetWeekday(LOCKED_DATE, -6));
  const submitRes = await submitOvertime(
    employee.api,
    workDate,
    2,
    'e2e: cutoff-blocked OT cancel',
  );
  expect(submitRes.ok(), await submitRes.text()).toBeTruthy();
  const created = (await submitRes.json()) as { id: string };

  const hr = await authenticateApi('hr');
  await setCutoff(hr.api, CUTOFF_DATE);
  await hr.api.dispose();

  const cancelRes = await employee.api.post(
    `/api/v1/overtime/${created.id}/cancel`,
  );
  expect(cancelRes.status()).toBe(409);
  const body = (await cancelRes.json()) as { code?: string };
  expect(body.code).toBe('PAYROLL_LOCKED');
  await employee.api.dispose();

  // Super Admin cleanup — reject bypasses lock.
  const admin = await authenticateApi('admin');
  await admin.api.post(`/api/v1/overtime/${created.id}/decision`, {
    data: { action: 'REJECT' },
  });
  await admin.api.dispose();

  const cleanup = await authenticateApi('hr');
  await setCutoff(cleanup.api, null);
  await cleanup.api.dispose();
});

// ---------------------------------------------------------------------------
// Helpers local to this spec
// ---------------------------------------------------------------------------

/**
 * Return a Date `n` business days before `iso` (a YYYY-MM-DD anchor).
 * Walks backwards one calendar day at a time, counting only Mon–Fri.
 *
 * We use this to derive unique weekday workDates around LOCKED_DATE
 * without accidentally producing collisions (which would fail with
 * `DUPLICATE_WORK_DATE`). The naive "add N and walk off weekends"
 * approach isn't injective — e.g. shifting a Monday back by 2 and by 3
 * both land on the previous Friday.
 */
function offsetWeekday(iso: string, businessDaysBack: number): Date {
  const parts = iso.split('-').map(Number);
  const [y, m, d] = parts as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  let remaining = Math.abs(businessDaysBack);
  while (remaining > 0) {
    dt.setUTCDate(dt.getUTCDate() - 1);
    if (dt.getUTCDay() !== 0 && dt.getUTCDay() !== 6) {
      remaining -= 1;
    }
  }
  return dt;
}
