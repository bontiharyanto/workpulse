import { expect, test } from '@playwright/test';

import { authenticateApi } from './helpers/api';
import { cancelOvertimeFor } from './helpers/cleanup';
import { nearestPastWeekday } from './helpers/dates';

/**
 * Notification preferences (Fase 22).
 *
 * We drive these API-first because the interesting properties are wire
 * contract, RBAC (any authenticated user can manage their own), and the
 * effective-gate behaviour at fanout time. UI coverage is handled by a
 * component-level lint (nothing to E2E-render there beyond a matrix of
 * checkboxes).
 *
 * Tests are serialized so we can safely mutate the HR user's preferences
 * inside one test and let a subsequent test restore defaults without
 * fighting a parallel spec that also touches the same rows.
 */
test.describe.configure({ mode: 'serial' });

const ALL_TYPES = [
  'LEAVE_SUBMITTED',
  'LEAVE_APPROVED_SUPERVISOR',
  'LEAVE_APPROVED_HR',
  'LEAVE_REJECTED',
  'LEAVE_CANCELLED',
  'OVERTIME_SUBMITTED',
  'OVERTIME_APPROVED',
  'OVERTIME_REJECTED',
  'OVERTIME_CANCELLED',
  'OVERTIME_COMPLETED',
  'PASSWORD_RESET',
  'ATTENDANCE_ABSENT_MARKED',
  'ATTENDANCE_CORRECTION_SUBMITTED',
  'ATTENDANCE_CORRECTION_APPROVED',
  'ATTENDANCE_CORRECTION_REJECTED',
];

interface PreferenceRow {
  type: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  mandatory: boolean;
}

test('EMPLOYEE: GET /notifications/preferences returns full matrix with defaults-on', async () => {
  const { api } = await authenticateApi('employee');
  const res = await api.get('/api/v1/notifications/preferences');
  expect(res.status()).toBe(200);
  const rows = (await res.json()) as PreferenceRow[];
  expect(rows.length).toBe(ALL_TYPES.length);
  const returned = new Set(rows.map((r) => r.type));
  for (const t of ALL_TYPES) expect(returned.has(t)).toBe(true);
  const pw = rows.find((r) => r.type === 'PASSWORD_RESET');
  expect(pw?.mandatory).toBe(true);
  expect(pw?.emailEnabled).toBe(true);
  expect(pw?.inAppEnabled).toBe(true);
  await api.dispose();
});

test('EMPLOYEE: PUT /notifications/preferences persists overrides and echoes fresh list', async () => {
  const { api } = await authenticateApi('employee');
  const putRes = await api.put('/api/v1/notifications/preferences', {
    data: {
      updates: [
        {
          type: 'LEAVE_APPROVED_HR',
          emailEnabled: false,
          inAppEnabled: true,
        },
      ],
    },
  });
  expect(putRes.status()).toBe(200);
  const rows = (await putRes.json()) as PreferenceRow[];
  const changed = rows.find((r) => r.type === 'LEAVE_APPROVED_HR');
  expect(changed).toEqual({
    type: 'LEAVE_APPROVED_HR',
    emailEnabled: false,
    inAppEnabled: true,
    mandatory: false,
  });
  // Independent GET returns the same shape (the response is authoritative).
  const getRes = await api.get('/api/v1/notifications/preferences');
  const fresh = (await getRes.json()) as PreferenceRow[];
  const via = fresh.find((r) => r.type === 'LEAVE_APPROVED_HR');
  expect(via).toEqual(changed);

  // Restore defaults so other tests see a clean baseline.
  await api.put('/api/v1/notifications/preferences', {
    data: {
      updates: [
        {
          type: 'LEAVE_APPROVED_HR',
          emailEnabled: true,
          inAppEnabled: true,
        },
      ],
    },
  });
  await api.dispose();
});

test('EMPLOYEE: PUT silently ignores mandatory types (PASSWORD_RESET stays on)', async () => {
  const { api } = await authenticateApi('employee');
  // Try to disable PASSWORD_RESET — the server should NOT respect this.
  const putRes = await api.put('/api/v1/notifications/preferences', {
    data: {
      updates: [
        {
          type: 'PASSWORD_RESET',
          emailEnabled: false,
          inAppEnabled: false,
        },
      ],
    },
  });
  expect(putRes.status()).toBe(200);
  const rows = (await putRes.json()) as PreferenceRow[];
  const pw = rows.find((r) => r.type === 'PASSWORD_RESET');
  expect(pw?.mandatory).toBe(true);
  expect(pw?.emailEnabled).toBe(true);
  expect(pw?.inAppEnabled).toBe(true);
  await api.dispose();
});

test('PUT with empty updates returns 200 + full defaults list (no-op)', async () => {
  const { api } = await authenticateApi('employee');
  const res = await api.put('/api/v1/notifications/preferences', {
    data: { updates: [] },
  });
  expect(res.status()).toBe(200);
  const rows = (await res.json()) as PreferenceRow[];
  expect(rows.length).toBe(ALL_TYPES.length);
  await api.dispose();
});

test('PUT rejects unknown NotificationType with 400 validation error', async () => {
  const { api } = await authenticateApi('employee');
  const res = await api.put('/api/v1/notifications/preferences', {
    data: {
      updates: [
        {
          type: 'NOT_A_REAL_TYPE',
          emailEnabled: true,
          inAppEnabled: true,
        },
      ],
    },
  });
  expect(res.status()).toBe(400);
  await api.dispose();
});

test('Unauthenticated: cannot GET/PUT preferences (401)', async ({ request }) => {
  const base = process.env.E2E_API_URL ?? 'http://localhost:4000';
  const g = await request.get(`${base}/api/v1/notifications/preferences`);
  expect(g.status()).toBe(401);
  const p = await request.put(`${base}/api/v1/notifications/preferences`, {
    data: { updates: [] },
  });
  expect(p.status()).toBe(401);
});

test('Effective gate: after opting out of in-app for a type, a new notification for that type does NOT appear in list()', async () => {
  // The observable property here is "the preference actually gates
  // delivery". We probe by:
  //   1. HR opts out of OVERTIME_SUBMITTED in-app.
  //   2. Employee submits a fresh overtime → a *supervisor* notification
  //      would normally fire, but the "hr" account is not the supervisor,
  //      so we probe using the supervisor account instead.
  //   3. Supervisor opts out of OVERTIME_SUBMITTED in-app, employee
  //      submits another overtime, supervisor's unread list should NOT
  //      grow for OVERTIME_SUBMITTED specifically.
  //
  // We measure delta relative to pre-opt-out count to be resilient to
  // other specs that may have inserted overtime rows.
  const supervisor = await authenticateApi('supervisor');

  // Step A: record current OVERTIME_SUBMITTED count for supervisor.
  const preList = await supervisor.api.get(
    '/api/v1/notifications?limit=100',
  );
  const preRows = (await preList.json()) as Array<{ type: string }>;
  const preCount = preRows.filter((r) => r.type === 'OVERTIME_SUBMITTED').length;

  // Step B: opt supervisor out of in-app for OVERTIME_SUBMITTED.
  await supervisor.api.put('/api/v1/notifications/preferences', {
    data: {
      updates: [
        {
          type: 'OVERTIME_SUBMITTED',
          emailEnabled: true,
          inAppEnabled: false,
        },
      ],
    },
  });

  // Step C: employee submits a fresh overtime targeting a workDate that
  // is safely inside the 14-day submit window and not payroll-locked.
  // We use `nearestPastWeekday(2)` to always land on a business day
  // regardless of when the test runs — the previous hardcoded
  // `2026-07-15` broke on every calendar day past 2026-07-29 because
  // it fell outside the submit window and the API returned 400. We
  // also pre-cancel any stale overtime the employee still owns for
  // that date so the assertion probes a genuine INSERT (not a 409
  // dedup response).
  const employee = await authenticateApi('employee');
  const workDate = nearestPastWeekday(2);
  await cancelOvertimeFor(employee.api, workDate);
  const otRes = await employee.api.post('/api/v1/overtime', {
    data: {
      workDate,
      hours: 2,
      reason: 'e2e preference gate probe',
    },
  });
  // 201 = new row created; 409 = a concurrent request beat us to it
  // (unlikely with `workers: 1` but tolerated). Either way the
  // interesting probe is "no NEW supervisor notification was inserted".
  expect([201, 409]).toContain(otRes.status());

  // Step D: re-fetch supervisor list; OVERTIME_SUBMITTED count for
  // supervisor MUST NOT have grown.
  const postList = await supervisor.api.get(
    '/api/v1/notifications?limit=100',
  );
  const postRows = (await postList.json()) as Array<{ type: string }>;
  const postCount = postRows.filter(
    (r) => r.type === 'OVERTIME_SUBMITTED',
  ).length;
  expect(postCount).toBe(preCount);

  // Step E (cleanup): restore defaults so subsequent specs behave.
  await supervisor.api.put('/api/v1/notifications/preferences', {
    data: {
      updates: [
        {
          type: 'OVERTIME_SUBMITTED',
          emailEnabled: true,
          inAppEnabled: true,
        },
      ],
    },
  });

  await supervisor.api.dispose();
  await employee.api.dispose();
});
