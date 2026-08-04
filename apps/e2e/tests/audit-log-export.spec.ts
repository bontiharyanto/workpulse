import { expect, test } from '@playwright/test';

import { authenticateApi } from './helpers/api';

/**
 * Audit log NDJSON streaming export (Fase 26 / ADR-0013 follow-up).
 *
 * We assert wire contract (headers + line-delimited JSON body), RBAC,
 * filter propagation, and empty-result behaviour. We do NOT assert
 * exact row counts because they depend on the noise other specs have
 * created; the invariants under test are structural.
 *
 * Serialized because we may prime the audit table via config touches
 * (mirroring `audit-log.spec.ts`) and don't want to race a parallel
 * spec doing the same.
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
  createdAt: string;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Parse an NDJSON payload into rows. Skips blank lines defensively.
 * Throws if any non-blank line fails to parse — that's a wire-format
 * contract violation, worthy of a test failure.
 */
function parseNdjson(text: string): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    rows.push(JSON.parse(line) as AuditRow);
  }
  return rows;
}

async function primeAuditRows(api: import('@playwright/test').APIRequestContext): Promise<void> {
  // Two config PATCHes to guarantee we have COMPANY_CONFIG_UPDATED
  // rows regardless of what other specs did. Second call restores
  // the baseline so we don't leave drift.
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

test('HR: GET /admin/audit-log/export returns valid NDJSON + correct headers', async () => {
  const { api } = await authenticateApi('hr');
  await primeAuditRows(api);

  const res = await api.get('/api/v1/admin/audit-log/export');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/x-ndjson');
  expect(res.headers()['content-disposition']).toContain('attachment');
  expect(res.headers()['content-disposition']).toContain('.ndjson');
  expect(res.headers()['cache-control']).toContain('no-store');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');

  const body = await res.text();
  const rows = parseNdjson(body);
  expect(rows.length).toBeGreaterThan(0);

  for (const row of rows) {
    expect(typeof row.id).toBe('string');
    expect(typeof row.action).toBe('string');
    expect(typeof row.entityType).toBe('string');
    expect(typeof row.entityId).toBe('string');
    expect(typeof row.actorId).toBe('string');
    expect(typeof row.createdAt).toBe('string');
  }

  // Newest-first invariant carries over from the JSON list endpoint.
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = new Date(rows[i]!.createdAt).getTime();
    const b = new Date(rows[i + 1]!.createdAt).getTime();
    expect(a).toBeGreaterThanOrEqual(b);
  }
  await api.dispose();
});

test('HR: export honors the same filter set as the JSON list endpoint', async () => {
  const { api } = await authenticateApi('hr');
  await primeAuditRows(api);

  const res = await api.get(
    '/api/v1/admin/audit-log/export?entityType=Company&action=COMPANY_CONFIG_UPDATED',
  );
  expect(res.status()).toBe(200);
  const body = await res.text();
  const rows = parseNdjson(body);
  // Might be empty on a very quiet tenant, but every row (if any)
  // MUST match both filters.
  for (const row of rows) {
    expect(row.entityType).toBe('Company');
    expect(row.action).toBe('COMPANY_CONFIG_UPDATED');
  }
  await api.dispose();
});

test('HR: export with impossibly narrow filter returns valid but empty NDJSON', async () => {
  const { api } = await authenticateApi('hr');
  const res = await api.get(
    '/api/v1/admin/audit-log/export?entityType=DoesNotExist_' + Math.random().toString(36).slice(2),
  );
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/x-ndjson');
  const body = await res.text();
  // Empty NDJSON = literally the empty string (or possibly a single
  // trailing newline). Either way, no parseable rows.
  const rows = parseNdjson(body);
  expect(rows.length).toBe(0);
  await api.dispose();
});

test('SUPER_ADMIN: can also export the audit log', async () => {
  const { api } = await authenticateApi('admin');
  const res = await api.get('/api/v1/admin/audit-log/export');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/x-ndjson');
  await api.dispose();
});

test('SUPERVISOR: cannot export (403)', async () => {
  const { api } = await authenticateApi('supervisor');
  const res = await api.get('/api/v1/admin/audit-log/export');
  expect(res.status()).toBe(403);
  await api.dispose();
});

test('EMPLOYEE: cannot export (403)', async () => {
  const { api } = await authenticateApi('employee');
  const res = await api.get('/api/v1/admin/audit-log/export');
  expect(res.status()).toBe(403);
  await api.dispose();
});

test('Unauthenticated: cannot export (401)', async ({ request }) => {
  const base = process.env.E2E_API_URL ?? 'http://localhost:4000';
  const res = await request.get(`${base}/api/v1/admin/audit-log/export`);
  expect(res.status()).toBe(401);
});
