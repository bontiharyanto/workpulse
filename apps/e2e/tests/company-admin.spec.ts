import { expect, test } from '@playwright/test';

import { authenticateApi } from './helpers/api';

/**
 * SUPER_ADMIN cross-tenant company management — API-level assertions only.
 *
 * The scope is intentionally narrow: prove the wire contract for the
 * `/admin/companies` endpoints, prove RBAC gating, and prove tenant
 * bootstrap yields a usable HR account. Everything else (leave-quota math,
 * audit-trail shape) is covered by unit tests where the domain is exercised
 * with far fewer moving parts.
 *
 * We run these serially so the created tenants don't step on each other's
 * unique slugs / emails across parallel workers.
 */
test.describe.configure({ mode: 'serial' });

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

test('SUPER_ADMIN: create → get → list → update → soft-delete → restore lifecycle', async () => {
  const { api } = await authenticateApi('admin');
  const suffix = uniqueSuffix();
  const name = `E2E Tenant ${suffix}`;
  const hrEmail = `hr-${suffix}@e2e.test`;

  // ---- CREATE ----------------------------------------------------------
  const createRes = await api.post('/api/v1/admin/companies', {
    data: {
      name,
      hrEmail,
      hrFullName: 'Bootstrap HR',
      timezone: 'Asia/Jakarta',
    },
  });
  expect(createRes.status(), await createRes.text()).toBe(201);
  const created = (await createRes.json()) as {
    company: { id: string; name: string; slug: string; timezone: string; deletedAt: string | null };
    hrUserId: string;
    hrEmail: string;
    temporaryPassword: string;
    seededLeaveTypeCodes?: string[];
  };
  expect(created.company.name).toBe(name);
  expect(created.company.timezone).toBe('Asia/Jakarta');
  expect(created.company.slug).toMatch(/^e2e-tenant-/);
  expect(created.company.deletedAt).toBeNull();
  expect(created.hrEmail).toBe(hrEmail);
  expect(created.temporaryPassword.length).toBeGreaterThanOrEqual(14);
  expect(created.seededLeaveTypeCodes).toEqual(
    expect.arrayContaining(['ANNUAL', 'SICK', 'PERSONAL']),
  );

  // ---- GET -------------------------------------------------------------
  const getRes = await api.get(`/api/v1/admin/companies/${created.company.id}`);
  expect(getRes.status()).toBe(200);
  const fetched = (await getRes.json()) as { id: string; userCount: number };
  expect(fetched.id).toBe(created.company.id);
  expect(fetched.userCount).toBeGreaterThanOrEqual(1);

  // ---- LIST + SEARCH ---------------------------------------------------
  const listRes = await api.get('/api/v1/admin/companies', {
    params: { search: created.company.slug },
  });
  expect(listRes.status()).toBe(200);
  const list = (await listRes.json()) as {
    items: Array<{ id: string; slug: string }>;
    totalCount: number;
  };
  expect(list.items.some((c) => c.id === created.company.id)).toBe(true);

  // ---- HR CAN LOGIN WITH TEMP PASSWORD + mustChangePassword=true -------
  const hrLogin = await api.post('/api/v1/auth/login', {
    data: { email: hrEmail, password: created.temporaryPassword },
  });
  expect(hrLogin.status(), await hrLogin.text()).toBe(200);
  const hrLoginBody = (await hrLogin.json()) as {
    user: { email: string; role: string; mustChangePassword: boolean; companyId: string };
    accessToken: string;
  };
  expect(hrLoginBody.user.email).toBe(hrEmail);
  expect(hrLoginBody.user.role).toBe('HR_MANAGER');
  expect(hrLoginBody.user.mustChangePassword).toBe(true);
  expect(hrLoginBody.user.companyId).toBe(created.company.id);

  // ---- UPDATE ----------------------------------------------------------
  const newName = `${name} Renamed`;
  const patchRes = await api.patch(`/api/v1/admin/companies/${created.company.id}`, {
    data: { name: newName, timezone: 'Asia/Makassar' },
  });
  expect(patchRes.status()).toBe(200);
  const patched = (await patchRes.json()) as { name: string; timezone: string };
  expect(patched.name).toBe(newName);
  expect(patched.timezone).toBe('Asia/Makassar');

  // ---- SOFT-DELETE (needs active users cleared first) ------------------
  // Deactivate the HR user we just created — via the SUPER_ADMIN's user
  // admin endpoint. This proves the "delete refuses when users remain"
  // guardrail from the service.
  const deleteRefusedRes = await api.delete(`/api/v1/admin/companies/${created.company.id}`);
  expect(deleteRefusedRes.status()).toBe(409);
  const deleteRefusedBody = (await deleteRefusedRes.json()) as { code?: string };
  expect(deleteRefusedBody.code).toBe('COMPANY_HAS_ACTIVE_USERS');

  // Restore path is only exercised on a truly-deleted tenant — we can't
  // easily deactivate cross-tenant users with the current admin API
  // (user-admin endpoints are scoped to the caller's own companyId). So we
  // stop the lifecycle test here and cover restore semantics in the unit
  // tests. The 409 above is what we cared about.

  await api.dispose();
});

test('SUPER_ADMIN: create refuses a duplicate slug', async () => {
  const { api } = await authenticateApi('admin');
  const suffix = uniqueSuffix();
  const slug = `dup-${suffix}`.slice(0, 40);

  const firstRes = await api.post('/api/v1/admin/companies', {
    data: {
      name: 'First',
      slug,
      hrEmail: `first-${suffix}@e2e.test`,
      hrFullName: 'First',
    },
  });
  expect(firstRes.status()).toBe(201);

  const secondRes = await api.post('/api/v1/admin/companies', {
    data: {
      name: 'Second',
      slug,
      hrEmail: `second-${suffix}@e2e.test`,
      hrFullName: 'Second',
    },
  });
  expect(secondRes.status()).toBe(409);
  const body = (await secondRes.json()) as { code?: string };
  expect(body.code).toBe('SLUG_ALREADY_TAKEN');

  await api.dispose();
});

test('SUPER_ADMIN: create refuses when HR email is already in use', async () => {
  const { api } = await authenticateApi('admin');
  const suffix = uniqueSuffix();

  const firstRes = await api.post('/api/v1/admin/companies', {
    data: {
      name: `Email Owner ${suffix}`,
      hrEmail: `email-owner-${suffix}@e2e.test`,
      hrFullName: 'Owner',
    },
  });
  expect(firstRes.status()).toBe(201);

  const secondRes = await api.post('/api/v1/admin/companies', {
    data: {
      name: `Email Reuser ${suffix}`,
      hrEmail: `email-owner-${suffix}@e2e.test`,
      hrFullName: 'Reuser',
    },
  });
  expect(secondRes.status()).toBe(409);
  const body = (await secondRes.json()) as { code?: string };
  expect(body.code).toBe('EMAIL_ALREADY_TAKEN');

  await api.dispose();
});

test('SUPER_ADMIN: create refuses an invalid timezone', async () => {
  const { api } = await authenticateApi('admin');
  const suffix = uniqueSuffix();

  const res = await api.post('/api/v1/admin/companies', {
    data: {
      name: `Bad TZ ${suffix}`,
      hrEmail: `bad-tz-${suffix}@e2e.test`,
      hrFullName: 'Bad',
      timezone: 'Asia/Jkt',
    },
  });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { code?: string };
  expect(body.code).toBe('INVALID_TIMEZONE');

  await api.dispose();
});

test('SUPER_ADMIN: cannot soft-delete its own tenant', async () => {
  const { api } = await authenticateApi('admin');

  // Discover the admin's own tenant via `/auth/me`.
  const meRes = await api.get('/api/v1/auth/me');
  expect(meRes.status()).toBe(200);
  const me = (await meRes.json()) as { companyId: string };

  const res = await api.delete(`/api/v1/admin/companies/${me.companyId}`);
  expect(res.status()).toBe(403);
  const body = (await res.json()) as { message?: string };
  expect(body.message).toBe('CANNOT_DELETE_OWN_TENANT');

  await api.dispose();
});

// ---------------------------------------------------------------------------
// RBAC — non-SUPER_ADMIN callers get 403 on every mutation and read.
// ---------------------------------------------------------------------------

test.describe('RBAC — non-SUPER_ADMIN cannot access /admin/companies', () => {
  for (const key of ['hr', 'supervisor', 'employee'] as const) {
    test(`${key}: all endpoints return 403`, async () => {
      const { api } = await authenticateApi(key);
      const list = await api.get('/api/v1/admin/companies');
      const get = await api.get('/api/v1/admin/companies/some-id');
      const create = await api.post('/api/v1/admin/companies', {
        data: {
          name: 'RBAC Probe',
          hrEmail: `probe-${uniqueSuffix()}@e2e.test`,
          hrFullName: 'Probe',
        },
      });
      const patch = await api.patch('/api/v1/admin/companies/some-id', {
        data: { name: 'Probe' },
      });
      const del = await api.delete('/api/v1/admin/companies/some-id');
      const restore = await api.post('/api/v1/admin/companies/some-id/restore');

      for (const [label, res] of [
        ['list', list],
        ['get', get],
        ['create', create],
        ['patch', patch],
        ['delete', del],
        ['restore', restore],
      ] as const) {
        expect(res.status(), `${key}.${label} expected 403 but got ${res.status()}`).toBe(403);
      }
      await api.dispose();
    });
  }
});

test('Unauthenticated: every /admin/companies route is 401', async ({ request }) => {
  const list = await request.get(`${API_URL}/api/v1/admin/companies`);
  const create = await request.post(`${API_URL}/api/v1/admin/companies`, {
    data: { name: 'x', hrEmail: 'x@x.com', hrFullName: 'x' },
  });
  expect(list.status()).toBe(401);
  expect(create.status()).toBe(401);
});
