import { expect, test } from '@playwright/test';

import { authenticateApi } from './helpers/api';

/**
 * Audit log viewer (Fase 23).
 *
 * We rely on other specs having written audit rows (leave decisions,
 * overtime, absence, scanner cursor reset, …) — those specs run before
 * this one on CI, so the seed tenant has a rich audit history by the
 * time we get here. The properties we assert are structural: response
 * shape, RBAC, filter propagation, and cursor pagination invariants.
 *
 * We DO NOT assert exact row counts because they depend on which other
 * specs have run and how many mutations they made. That's a unit-test
 * concern, exercised in `audit.service.spec.ts`.
 */
test.describe.configure({ mode: 'serial' });

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  actorName: string | null;
  actorEmail: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface AuditPage {
  rows: AuditRow[];
  nextCursor: string | null;
}

/**
 * Prime the audit log with at least a couple of entries in the current
 * tenant so paging isn't accidentally empty. Any HR-callable write
 * works — we use a config PATCH that no-ops when payrollLockedUntil
 * is already null (idempotent + safe).
 */
async function primeAuditRows(
  api: import('@playwright/test').APIRequestContext,
): Promise<void> {
  // Fire a small config bump to guarantee at least 2 audit rows even
  // when the tenant is otherwise quiet. Value change is trivial: flip
  // absentScanGraceHours between 6 and 7. Two writes = one back to
  // baseline, so we don't leave drift for other specs.
  const cur = await api.get('/api/v1/admin/company');
  const before = (await cur.json()) as { absentScanGraceHours?: number };
  const baseline = before.absentScanGraceHours ?? 6;
  await api.patch('/api/v1/admin/company', {
    data: { absentScanGraceHours: baseline === 6 ? 7 : 6 },
  });
  await api.patch('/api/v1/admin/company', {
    data: { absentScanGraceHours: baseline },
  });
}

test('HR: GET /admin/audit-log returns rows with actor join + newest-first', async () => {
  const { api } = await authenticateApi('hr');
  await primeAuditRows(api);

  const res = await api.get('/api/v1/admin/audit-log?limit=10');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as AuditPage;

  expect(Array.isArray(body.rows)).toBe(true);
  expect(body.rows.length).toBeGreaterThan(0);
  for (const row of body.rows) {
    expect(typeof row.id).toBe('string');
    expect(typeof row.action).toBe('string');
    expect(typeof row.entityType).toBe('string');
    expect(typeof row.entityId).toBe('string');
    expect(typeof row.actorId).toBe('string');
    expect(typeof row.createdAt).toBe('string');
    // actorName / actorEmail may be null (soft-deleted user); when
    // present they must be strings, never numbers or objects.
    if (row.actorName !== null) expect(typeof row.actorName).toBe('string');
    if (row.actorEmail !== null) expect(typeof row.actorEmail).toBe('string');
  }

  // Newest-first invariant — every row's createdAt is >= the next one's.
  for (let i = 0; i + 1 < body.rows.length; i++) {
    const a = new Date(body.rows[i]!.createdAt).getTime();
    const b = new Date(body.rows[i + 1]!.createdAt).getTime();
    expect(a).toBeGreaterThanOrEqual(b);
  }

  await api.dispose();
});

test('HR: filter by action returns only rows with that action', async () => {
  const { api } = await authenticateApi('hr');
  await primeAuditRows(api);

  const res = await api.get(
    '/api/v1/admin/audit-log?action=COMPANY_CONFIG_UPDATED&limit=25',
  );
  expect(res.status()).toBe(200);
  const body = (await res.json()) as AuditPage;
  // Might be empty on a very quiet tenant, but the property under
  // test is "if we get any, every row matches".
  for (const row of body.rows) {
    expect(row.action).toBe('COMPANY_CONFIG_UPDATED');
  }
  await api.dispose();
});

test('HR: filter by entityType returns only rows for that entity', async () => {
  const { api } = await authenticateApi('hr');
  const res = await api.get(
    '/api/v1/admin/audit-log?entityType=Company&limit=25',
  );
  expect(res.status()).toBe(200);
  const body = (await res.json()) as AuditPage;
  for (const row of body.rows) {
    expect(row.entityType).toBe('Company');
  }
  await api.dispose();
});

test('HR: cursor pagination — page 2 keys off page 1, no overlap', async () => {
  const { api } = await authenticateApi('hr');
  await primeAuditRows(api);
  await primeAuditRows(api);
  await primeAuditRows(api);

  const first = await api.get('/api/v1/admin/audit-log?limit=2');
  const p1 = (await first.json()) as AuditPage;
  expect(p1.rows.length).toBeGreaterThan(0);

  if (!p1.nextCursor) {
    // Tenant is too quiet even after priming; abort softly.
    await api.dispose();
    return;
  }

  const second = await api.get(
    `/api/v1/admin/audit-log?limit=2&cursor=${encodeURIComponent(p1.nextCursor)}`,
  );
  expect(second.status()).toBe(200);
  const p2 = (await second.json()) as AuditPage;

  // No id from page 1 can appear on page 2.
  const p1Ids = new Set(p1.rows.map((r) => r.id));
  for (const row of p2.rows) {
    expect(p1Ids.has(row.id)).toBe(false);
  }

  // Cursor invariant: every row on page 2 is strictly older than the
  // last row of page 1 (or same timestamp with a lower id).
  const anchor = p1.rows[p1.rows.length - 1]!;
  const anchorTs = new Date(anchor.createdAt).getTime();
  for (const row of p2.rows) {
    const rowTs = new Date(row.createdAt).getTime();
    if (rowTs === anchorTs) {
      expect(row.id < anchor.id).toBe(true);
    } else {
      expect(rowTs).toBeLessThan(anchorTs);
    }
  }
  await api.dispose();
});

test('HR: invalid cursor returns 400 INVALID_CURSOR', async () => {
  const { api } = await authenticateApi('hr');
  const res = await api.get('/api/v1/admin/audit-log?cursor=not-a-real-cursor');
  expect(res.status()).toBe(400);
  await api.dispose();
});

test('SUPER_ADMIN: can also read the audit log', async () => {
  const { api } = await authenticateApi('admin');
  const res = await api.get('/api/v1/admin/audit-log?limit=1');
  expect(res.status()).toBe(200);
  await api.dispose();
});

test('SUPERVISOR: cannot read the audit log (403)', async () => {
  const { api } = await authenticateApi('supervisor');
  const res = await api.get('/api/v1/admin/audit-log?limit=1');
  expect(res.status()).toBe(403);
  await api.dispose();
});

test('EMPLOYEE: cannot read the audit log (403)', async () => {
  const { api } = await authenticateApi('employee');
  const res = await api.get('/api/v1/admin/audit-log?limit=1');
  expect(res.status()).toBe(403);
  await api.dispose();
});

test('Unauthenticated: cannot read the audit log (401)', async ({ request }) => {
  const base = process.env.E2E_API_URL ?? 'http://localhost:4000';
  const res = await request.get(`${base}/api/v1/admin/audit-log`);
  expect(res.status()).toBe(401);
});
