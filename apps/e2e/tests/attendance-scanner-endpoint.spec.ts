import { expect, test } from '@playwright/test';

import { authenticateApi } from './helpers/api';

/**
 * Auto-absent scanner endpoint — API-level assertions only.
 *
 * We deliberately don't drive the UI here: there is no UI for the
 * scanner trigger (it's a SUPER_ADMIN-only maintenance action), and
 * the interesting properties are wire-protocol invariants (auth
 * shape, response schema, idempotency).
 *
 * Because auto-absent classification is driven by tenant-local grace
 * windows and by cursor state that other specs may have advanced, we
 * assert on the RESPONSE SHAPE — not on `totalMarked` being a specific
 * number. Concrete counts belong in the unit tests where the domain
 * classifier is exercised in isolation.
 */
test.describe.configure({ mode: 'serial' });

test('SUPER_ADMIN: POST /attendance/scanner/run returns the expected schema', async () => {
  const { api } = await authenticateApi('admin');
  const res = await api.post('/api/v1/attendance/scanner/run');
  expect(res.status()).toBe(202);
  const body = (await res.json()) as {
    scannedCompanies?: unknown;
    totalMarked?: unknown;
    durationMs?: unknown;
  };
  expect(typeof body.scannedCompanies).toBe('number');
  expect(typeof body.totalMarked).toBe('number');
  expect(typeof body.durationMs).toBe('number');
  expect(body.scannedCompanies).toBeGreaterThanOrEqual(0);
  expect(body.totalMarked).toBeGreaterThanOrEqual(0);
  expect(body.durationMs).toBeGreaterThanOrEqual(0);
  await api.dispose();
});

test('SUPER_ADMIN: subsequent scanner run is idempotent (no new markings second time)', async () => {
  const { api } = await authenticateApi('admin');
  await api.post('/api/v1/attendance/scanner/run');
  const secondRes = await api.post('/api/v1/attendance/scanner/run');
  expect(secondRes.status()).toBe(202);
  const body = (await secondRes.json()) as { totalMarked?: number };
  // Second consecutive run within the same minute cannot mark anything
  // new: the cursor has already advanced and every date is already
  // marked or skipped-with-reason.
  expect(body.totalMarked).toBe(0);
  await api.dispose();
});

test('HR_MANAGER: cannot trigger the scanner (403 Forbidden)', async () => {
  const { api } = await authenticateApi('hr');
  const res = await api.post('/api/v1/attendance/scanner/run');
  expect(res.status()).toBe(403);
  await api.dispose();
});

test('SUPERVISOR: cannot trigger the scanner (403 Forbidden)', async () => {
  const { api } = await authenticateApi('supervisor');
  const res = await api.post('/api/v1/attendance/scanner/run');
  expect(res.status()).toBe(403);
  await api.dispose();
});

test('Unauthenticated: cannot trigger the scanner (401 Unauthorized)', async ({ request }) => {
  const res = await request.post(
    `${process.env.E2E_API_URL ?? 'http://localhost:4000'}/api/v1/attendance/scanner/run`,
  );
  expect(res.status()).toBe(401);
});

// ---------------------------------------------------------------------------
// reset-cursor endpoint (ADR-0010 follow-up)
// ---------------------------------------------------------------------------

test('SUPER_ADMIN: POST /attendance/scanner/reset-cursor clears the cursor', async () => {
  const { api } = await authenticateApi('admin');
  // Prime the cursor by running the scanner first — this guarantees
  // `lastAbsentScanDate` is non-null when we run the reset, so the
  // `before` field returned by reset is meaningful.
  await api.post('/api/v1/attendance/scanner/run');

  const res = await api.post('/api/v1/attendance/scanner/reset-cursor', {
    data: {},
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    before?: unknown;
    after?: unknown;
    rescanTriggered?: unknown;
    rescanResult?: unknown;
  };
  expect(body.after).toBeNull();
  expect(body.rescanTriggered).toBe(false);
  expect(body.rescanResult).toBeUndefined();
  // `before` is either an ISO date string or null (tenant never scanned).
  expect(
    body.before === null || typeof body.before === 'string',
  ).toBeTruthy();
  await api.dispose();
});

test('SUPER_ADMIN: reset-cursor with triggerRescan=true returns a rescanResult payload', async () => {
  const { api } = await authenticateApi('admin');
  const res = await api.post('/api/v1/attendance/scanner/reset-cursor', {
    data: { triggerRescan: true },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    after: unknown;
    rescanTriggered: unknown;
    rescanResult?: {
      companyId?: unknown;
      scannedDates?: unknown;
      marked?: unknown;
      durationMs?: unknown;
      skipped?: Record<string, unknown>;
    };
  };
  expect(body.after).toBeNull();
  expect(body.rescanTriggered).toBe(true);
  expect(body.rescanResult).toBeDefined();
  expect(typeof body.rescanResult?.companyId).toBe('string');
  expect(typeof body.rescanResult?.scannedDates).toBe('number');
  expect(typeof body.rescanResult?.marked).toBe('number');
  expect(typeof body.rescanResult?.durationMs).toBe('number');
  expect(body.rescanResult?.skipped).toMatchObject({
    PAYROLL_LOCKED: expect.any(Number),
    ALREADY_MARKED: expect.any(Number),
  });
  await api.dispose();
});

test('HR_MANAGER: cannot reset the scanner cursor (403 Forbidden)', async () => {
  const { api } = await authenticateApi('hr');
  const res = await api.post('/api/v1/attendance/scanner/reset-cursor', {
    data: {},
  });
  expect(res.status()).toBe(403);
  await api.dispose();
});

test('SUPERVISOR: cannot reset the scanner cursor (403 Forbidden)', async () => {
  const { api } = await authenticateApi('supervisor');
  const res = await api.post('/api/v1/attendance/scanner/reset-cursor', {
    data: {},
  });
  expect(res.status()).toBe(403);
  await api.dispose();
});

test('Unauthenticated: cannot reset the scanner cursor (401 Unauthorized)', async ({
  request,
}) => {
  const res = await request.post(
    `${process.env.E2E_API_URL ?? 'http://localhost:4000'}/api/v1/attendance/scanner/reset-cursor`,
    { data: {} },
  );
  expect(res.status()).toBe(401);
});
