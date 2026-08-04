import { expect, test } from '@playwright/test';

import { authenticateApi } from './helpers/api';

/**
 * Manual HR override endpoints — `POST /attendance/absence` and
 * `DELETE /attendance/absence/:id`.
 *
 * We drive these API-first (not through the UI) for the same reasons as
 * the scanner spec: the interesting properties are wire contract and
 * RBAC, not pixels. UI coverage is handled by the unit test on
 * `team-attendance.tsx`.
 *
 * Tests are serialized because the same seed user is being flipped
 * absent/not-absent across cases; parallel runs would race.
 */
test.describe.configure({ mode: 'serial' });

// Pick a date at least a few days back so it's outside any grace window
// and outside any auto-scheduler cursor drift from other specs.
// `2026-07-01` is deliberately older than "yesterday" so the scanner
// (which caps its backfill at 30 days from the cursor) has already moved
// past it without touching this date.
const WORK_DATE = '2026-07-01';

async function findTargetUserId(api: import('@playwright/test').APIRequestContext): Promise<string> {
  // Grab the employee seed via the roster endpoint. We use the team-today
  // response the HR sees; `employee@acme.test` is guaranteed to be there.
  const res = await api.get(`/api/v1/attendance/team/today`);
  expect(res.ok()).toBeTruthy();
  const roster = (await res.json()) as ReadonlyArray<{
    userId: string;
    email: string;
  }>;
  const employee = roster.find((r) => r.email === 'employee@acme.test');
  if (!employee) {
    throw new Error(
      `attendance-manual-absence: could not resolve employee@acme.test from HR roster (got ${roster.length} rows)`,
    );
  }
  return employee.userId;
}

async function findExistingAbsence(
  api: import('@playwright/test').APIRequestContext,
  targetUserId: string,
  date: string,
): Promise<string | null> {
  const res = await api.get(`/api/v1/attendance/team/today?date=${date}`);
  if (!res.ok()) return null;
  const rows = (await res.json()) as ReadonlyArray<{
    userId: string;
    absenceRecordId: string | null;
  }>;
  return rows.find((r) => r.userId === targetUserId)?.absenceRecordId ?? null;
}

test('HR: full mark-then-delete lifecycle round-trips through team roster', async () => {
  const { api } = await authenticateApi('hr');
  const targetUserId = await findTargetUserId(api);

  // Pre-clean: if a previous run of this spec left a row around, drop it
  // first. Idempotency > cross-spec flakiness.
  const preExisting = await findExistingAbsence(api, targetUserId, WORK_DATE);
  if (preExisting) {
    await api.delete(`/api/v1/attendance/absence/${preExisting}`);
  }

  // 1. Mark the user absent.
  const createRes = await api.post('/api/v1/attendance/absence', {
    data: {
      userId: targetUserId,
      workDate: WORK_DATE,
      reason: 'E2E: no-show without notice',
    },
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as {
    id: string;
    userId: string;
    workDate: string;
    source: string;
    reason: string | null;
    markedById: string | null;
  };
  expect(created.userId).toBe(targetUserId);
  expect(created.workDate).toBe(WORK_DATE);
  expect(created.source).toBe('MANUAL_HR');
  expect(created.reason).toContain('E2E');
  expect(typeof created.markedById).toBe('string');

  // 2. Roster now shows ABSENT + carries the id + source badge.
  const rosterRes = await api.get(`/api/v1/attendance/team/today?date=${WORK_DATE}`);
  expect(rosterRes.ok()).toBeTruthy();
  const rows = (await rosterRes.json()) as ReadonlyArray<{
    userId: string;
    status: string;
    absenceRecordId: string | null;
    absenceSource: string | null;
  }>;
  const targetRow = rows.find((r) => r.userId === targetUserId);
  expect(targetRow?.status).toBe('ABSENT');
  expect(targetRow?.absenceRecordId).toBe(created.id);
  expect(targetRow?.absenceSource).toBe('MANUAL_HR');

  // 3. Delete → 204, roster reverts.
  const deleteRes = await api.delete(`/api/v1/attendance/absence/${created.id}`);
  expect(deleteRes.status()).toBe(204);

  const afterRes = await api.get(`/api/v1/attendance/team/today?date=${WORK_DATE}`);
  const afterRows = (await afterRes.json()) as ReadonlyArray<{
    userId: string;
    status: string;
  }>;
  const afterRow = afterRows.find((r) => r.userId === targetUserId);
  // No attendance record + no absence + no leave for that day → NOT_CLOCKED_IN.
  expect(afterRow?.status).toBe('NOT_CLOCKED_IN');

  // 4. Deleting again → 404.
  const doubleDelete = await api.delete(`/api/v1/attendance/absence/${created.id}`);
  expect(doubleDelete.status()).toBe(404);

  await api.dispose();
});

test('HR: second mark on the same (user, date) returns 409 CONFLICT', async () => {
  const { api } = await authenticateApi('hr');
  const targetUserId = await findTargetUserId(api);

  // Ensure a clean slate first.
  const existing = await findExistingAbsence(api, targetUserId, WORK_DATE);
  if (existing) await api.delete(`/api/v1/attendance/absence/${existing}`);

  const first = await api.post('/api/v1/attendance/absence', {
    data: { userId: targetUserId, workDate: WORK_DATE },
  });
  expect(first.status()).toBe(201);
  const firstBody = (await first.json()) as { id: string };

  const second = await api.post('/api/v1/attendance/absence', {
    data: { userId: targetUserId, workDate: WORK_DATE, reason: 'duplicate' },
  });
  expect(second.status()).toBe(409);

  // Clean up so the next spec starts fresh.
  await api.delete(`/api/v1/attendance/absence/${firstBody.id}`);
  await api.dispose();
});

test('HR: refuses future dates + malformed userId (400 BAD_REQUEST)', async () => {
  const { api } = await authenticateApi('hr');
  const targetUserId = await findTargetUserId(api);

  const future = new Date();
  future.setUTCDate(future.getUTCDate() + 5);
  const futureIso = future.toISOString().slice(0, 10);
  const futureRes = await api.post('/api/v1/attendance/absence', {
    data: { userId: targetUserId, workDate: futureIso },
  });
  expect(futureRes.status()).toBe(400);

  const badIdRes = await api.post('/api/v1/attendance/absence', {
    data: { userId: '!invalid!', workDate: WORK_DATE },
  });
  expect(badIdRes.status()).toBe(400);

  await api.dispose();
});

test('SUPERVISOR: cannot mark absent (403 Forbidden)', async () => {
  const { api } = await authenticateApi('supervisor');
  const res = await api.post('/api/v1/attendance/absence', {
    data: { userId: 'stub', workDate: WORK_DATE },
  });
  // Depending on order-of-validation, the guard may reject before the
  // DTO ever gets parsed. Either way this must not succeed.
  expect([400, 403]).toContain(res.status());
  await api.dispose();
});

test('EMPLOYEE: cannot mark absent (403 Forbidden)', async () => {
  const { api } = await authenticateApi('employee');
  const res = await api.post('/api/v1/attendance/absence', {
    data: { userId: 'stub', workDate: WORK_DATE },
  });
  expect([400, 403]).toContain(res.status());
  await api.dispose();
});

test('Unauthenticated: cannot mark or delete (401 Unauthorized)', async ({ request }) => {
  const baseUrl = process.env.E2E_API_URL ?? 'http://localhost:4000';
  const post = await request.post(`${baseUrl}/api/v1/attendance/absence`, {
    data: { userId: 'stub', workDate: WORK_DATE },
  });
  expect(post.status()).toBe(401);

  const del = await request.delete(`${baseUrl}/api/v1/attendance/absence/stub`);
  expect(del.status()).toBe(401);
});
