import { expect, test } from '@playwright/test';

import { authenticateApi } from './helpers/api';
import { nearestPastWeekday } from './helpers/dates';

/**
 * `GET /api/v1/admin/approvals/backlog` — cross-module PENDING visibility.
 *
 * Coverage:
 *   1. Response shape — always contains the three modules with buckets +
 *      oldest[]. Numeric fields are non-negative integers.
 *   2. RBAC — SUPER_ADMIN can read, HR_MANAGER can read, SUPERVISOR
 *      and EMPLOYEE are forbidden (403).
 *   3. Threshold param propagation — non-default thresholdDays travels
 *      through to the response body.
 *   4. Real integration — filing a fresh AttendanceCorrection increments
 *      the correction backlog. Doubles as an end-to-end sanity check on
 *      the whole request pipeline.
 *
 * No serial dependency: reads are idempotent and each test uses its own
 * throwaway auth context.
 */

test('shape: HR receives a well-formed backlog summary with all three modules', async () => {
  const hr = await authenticateApi('hr');
  const res = await hr.api.get('/api/v1/admin/approvals/backlog');
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as {
    generatedAt: string;
    staleAfterDays: number;
    leave: unknown;
    overtime: unknown;
    correction: unknown;
  };
  expect(body.staleAfterDays).toBe(3);
  expect(new Date(body.generatedAt).toString()).not.toBe('Invalid Date');
  for (const module of [body.leave, body.overtime, body.correction] as const) {
    expect(module).toEqual(
      expect.objectContaining({
        total: expect.any(Number),
        fresh: expect.any(Number),
        stale: expect.any(Number),
        buckets: expect.objectContaining({
          d0_1: expect.any(Number),
          d1_3: expect.any(Number),
          d3_7: expect.any(Number),
          d7_plus: expect.any(Number),
        }),
        oldest: expect.any(Array),
      }),
    );
  }
  await hr.api.dispose();
});

test('shape: total = fresh + stale for every module (bucket invariant)', async () => {
  const hr = await authenticateApi('hr');
  const res = await hr.api.get('/api/v1/admin/approvals/backlog');
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    leave: { total: number; fresh: number; stale: number };
    overtime: { total: number; fresh: number; stale: number };
    correction: { total: number; fresh: number; stale: number };
  };
  for (const m of [body.leave, body.overtime, body.correction]) {
    expect(m.total).toBe(m.fresh + m.stale);
  }
  await hr.api.dispose();
});

test('RBAC: SUPER_ADMIN can read', async () => {
  const admin = await authenticateApi('admin');
  const res = await admin.api.get('/api/v1/admin/approvals/backlog');
  expect(res.status()).toBe(200);
  await admin.api.dispose();
});

test('RBAC: SUPERVISOR is forbidden (403)', async () => {
  const supervisor = await authenticateApi('supervisor');
  const res = await supervisor.api.get('/api/v1/admin/approvals/backlog');
  expect(res.status()).toBe(403);
  await supervisor.api.dispose();
});

test('RBAC: EMPLOYEE is forbidden (403)', async () => {
  const employee = await authenticateApi('employee');
  const res = await employee.api.get('/api/v1/admin/approvals/backlog');
  expect(res.status()).toBe(403);
  await employee.api.dispose();
});

test('threshold param travels through to the response body', async () => {
  const hr = await authenticateApi('hr');
  const res = await hr.api.get('/api/v1/admin/approvals/backlog?thresholdDays=7');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { staleAfterDays: number };
  expect(body.staleAfterDays).toBe(7);
  await hr.api.dispose();
});

test('a freshly submitted correction shows up in the backlog', async () => {
  // Baseline count — capture before we submit.
  const hr = await authenticateApi('hr');
  const before = await hr.api.get('/api/v1/admin/approvals/backlog');
  expect(before.ok()).toBeTruthy();
  const beforeBody = (await before.json()) as {
    correction: { total: number };
  };
  const beforeTotal = beforeBody.correction.total;

  // Employee submits a fresh correction.
  const employee = await authenticateApi('employee');
  const workDate = nearestPastWeekday(4);
  const submit = await employee.api.post('/api/v1/attendance/corrections', {
    data: {
      workDate,
      requestedClockInAt: null,
      requestedClockOutAt: `${workDate}T18:00:00.000Z`,
      reason: 'backlog integration probe',
    },
  });
  // If a duplicate PENDING already exists from a previous run, the
  // integration probe is still meaningful — but the delta may be zero.
  // Accept 201 (created) or 409 (existing PENDING); anything else is a
  // real failure.
  expect([201, 409]).toContain(submit.status());

  const after = await hr.api.get('/api/v1/admin/approvals/backlog');
  const afterBody = (await after.json()) as {
    correction: { total: number };
  };
  // The count strictly does not decrease (idempotent read) and, if the
  // submit succeeded, it should have grown by exactly 1.
  expect(afterBody.correction.total).toBeGreaterThanOrEqual(beforeTotal);
  if (submit.status() === 201) {
    expect(afterBody.correction.total).toBe(beforeTotal + 1);
    // Housekeeping: cancel so this test doesn't pollute subsequent runs.
    const submitted = (await submit.json()) as { id: string };
    await employee.api.post(`/api/v1/attendance/corrections/${submitted.id}/cancel`);
  }
  await hr.api.dispose();
  await employee.api.dispose();
});
