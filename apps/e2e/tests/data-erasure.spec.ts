import { expect, test, type APIRequestContext } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';

/**
 * Fase 31b — right-to-erasure API surface.
 *
 * The worker runs every 5 minutes in-process. The `test-support`
 * controller (only wired when `THROTTLER_DISABLED=true`) exposes a
 * `fast-forward` endpoint that rewinds `scheduledFor` past NOW, and
 * a `tick` endpoint that runs the worker inline. Together the tests
 * exercise the full request → approve → execute path in seconds.
 *
 * Ordering matters: the "execute" test permanently anonymises
 * `employee@acme.test`, so every non-destructive assertion must run
 * BEFORE it. Playwright is configured serially at the project level.
 */

test.describe.configure({ mode: 'serial' });

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

async function login(
  email: string,
  password: string,
): Promise<{ ctx: APIRequestContext; accessToken: string }> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  const res = await ctx.post('/api/v1/auth/login', {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(`login failed for ${email}: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { accessToken: string };
  return { ctx, accessToken: body.accessToken };
}

async function pruneErasures(emails: string[]): Promise<void> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    for (const email of emails) {
      await ctx
        .post('/api/v1/test-support/data-erasure/prune', {
          data: { email },
        })
        .catch(() => undefined);
    }
  } finally {
    await ctx.dispose();
  }
}

test.beforeAll(async () => {
  await pruneErasures([
    SEED_USERS.employee.email,
    SEED_USERS.supervisor.email,
    SEED_USERS.hr.email,
    SEED_USERS.admin.email,
  ]);
});

// -----------------------------------------------------------------------------
// Non-destructive flows first
// -----------------------------------------------------------------------------

test('user can cancel while APPROVED_SCHEDULED', async () => {
  await pruneErasures([SEED_USERS.supervisor.email]);
  const supervisor = await login(
    SEED_USERS.supervisor.email,
    SEED_USERS.supervisor.password,
  );
  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);

  const createRes = await supervisor.ctx.post('/api/v1/me/data-erasure', {
    headers: { Authorization: `Bearer ${supervisor.accessToken}` },
    data: {},
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as { id: string };

  const approveRes = await hr.ctx.post(
    `/api/v1/admin/data-erasure/${created.id}/approve`,
    {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
      data: {},
    },
  );
  expect(approveRes.status()).toBe(200);

  const cancelRes = await supervisor.ctx.post(
    `/api/v1/me/data-erasure/${created.id}/cancel`,
    { headers: { Authorization: `Bearer ${supervisor.accessToken}` } },
  );
  expect(cancelRes.status()).toBe(200);
  const cancelled = (await cancelRes.json()) as { status: string };
  expect(cancelled.status).toBe('CANCELLED');

  await supervisor.ctx.dispose();
  await hr.ctx.dispose();
});

test('HR can reject with a mandatory note', async () => {
  await pruneErasures([SEED_USERS.supervisor.email]);

  const supervisor = await login(
    SEED_USERS.supervisor.email,
    SEED_USERS.supervisor.password,
  );
  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);

  const createRes = await supervisor.ctx.post('/api/v1/me/data-erasure', {
    headers: { Authorization: `Bearer ${supervisor.accessToken}` },
    data: {},
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as { id: string };

  const noNote = await hr.ctx.post(
    `/api/v1/admin/data-erasure/${created.id}/reject`,
    {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
      data: {},
    },
  );
  expect(noNote.status()).toBe(400);

  const rejectRes = await hr.ctx.post(
    `/api/v1/admin/data-erasure/${created.id}/reject`,
    {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
      data: { note: 'kontrak masih aktif' },
    },
  );
  expect(rejectRes.status()).toBe(200);
  const rejected = (await rejectRes.json()) as {
    status: string;
    decisionNote: string;
  };
  expect(rejected.status).toBe('REJECTED');
  expect(rejected.decisionNote).toBe('kontrak masih aktif');

  await supervisor.ctx.dispose();
  await hr.ctx.dispose();
});

test('EMPLOYEE / SUPERVISOR cannot hit the admin endpoints', async () => {
  const employee = await login(
    SEED_USERS.employee.email,
    SEED_USERS.employee.password,
  );

  const forbidden = await employee.ctx.get('/api/v1/admin/data-erasure/pending', {
    headers: { Authorization: `Bearer ${employee.accessToken}` },
  });
  expect(forbidden.status()).toBe(403);

  await employee.ctx.dispose();
});

test('HR cannot approve their own erasure request; another admin can', async () => {
  await pruneErasures([SEED_USERS.hr.email]);

  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
  const createRes = await hr.ctx.post('/api/v1/me/data-erasure', {
    headers: { Authorization: `Bearer ${hr.accessToken}` },
    data: {},
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as { id: string };

  const selfApprove = await hr.ctx.post(
    `/api/v1/admin/data-erasure/${created.id}/approve`,
    {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
      data: {},
    },
  );
  expect(selfApprove.status()).toBe(403);
  const body = await selfApprove.json();
  expect(body.code).toBe('ERASURE_SELF_APPROVAL');

  const admin = await login(SEED_USERS.admin.email, SEED_USERS.admin.password);
  const otherApprove = await admin.ctx.post(
    `/api/v1/admin/data-erasure/${created.id}/approve`,
    {
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      data: {},
    },
  );
  expect(otherApprove.status()).toBe(200);

  // Clean up so a subsequent tick does not anonymise HR.
  const cancelRes = await hr.ctx.post(
    `/api/v1/me/data-erasure/${created.id}/cancel`,
    { headers: { Authorization: `Bearer ${hr.accessToken}` } },
  );
  expect(cancelRes.status()).toBe(200);

  await hr.ctx.dispose();
  await admin.ctx.dispose();
});

// -----------------------------------------------------------------------------
// Destructive flow — must run LAST because it anonymises `employee@acme.test`
// -----------------------------------------------------------------------------

test('employee submits an erasure request; HR approves; worker executes', async () => {
  // Provision a throwaway user so the destructive lifecycle does
  // not anonymise `employee@acme.test` — that would break every
  // subsequent test in the run that uses the seed user.
  const { request } = await import('@playwright/test');
  const support = await request.newContext({ baseURL: API_URL });
  let throwawayEmail: string;
  try {
    const res = await support.post('/api/v1/test-support/user/create-throwaway', {
      data: { sourceEmail: SEED_USERS.employee.email },
    });
    if (!res.ok()) {
      throw new Error(
        `test-support create-throwaway failed: ${res.status()} ${await res.text()}`,
      );
    }
    const body = (await res.json()) as { email: string };
    throwawayEmail = body.email;
  } finally {
    await support.dispose();
  }

  const employee = await login(throwawayEmail, SEED_USERS.employee.password);

  const createRes = await employee.ctx.post('/api/v1/me/data-erasure', {
    headers: { Authorization: `Bearer ${employee.accessToken}` },
    data: { reason: 'sudah tidak bekerja di perusahaan ini' },
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as {
    id: string;
    status: string;
    reason: string;
  };
  expect(created.status).toBe('PENDING_APPROVAL');
  expect(created.reason).toContain('sudah tidak bekerja');

  // Duplicate creation is rejected with 409.
  const dupe = await employee.ctx.post('/api/v1/me/data-erasure', {
    headers: { Authorization: `Bearer ${employee.accessToken}` },
    data: {},
  });
  expect(dupe.status()).toBe(409);
  const dupeBody = await dupe.json();
  expect(dupeBody.code).toBe('ERASURE_ALREADY_PENDING');

  const hr = await login(SEED_USERS.hr.email, SEED_USERS.hr.password);
  const approveRes = await hr.ctx.post(
    `/api/v1/admin/data-erasure/${created.id}/approve`,
    {
      headers: { Authorization: `Bearer ${hr.accessToken}` },
      data: { note: 'ok, dijadwalkan' },
    },
  );
  expect(approveRes.status()).toBe(200);
  const approved = (await approveRes.json()) as {
    status: string;
    scheduledFor: string | null;
  };
  expect(approved.status).toBe('APPROVED_SCHEDULED');
  expect(approved.scheduledFor).not.toBeNull();

  const ff = await request.newContext({ baseURL: API_URL });
  try {
    const ffRes = await ff.post(
      '/api/v1/test-support/data-erasure/fast-forward',
      { data: { id: created.id } },
    );
    expect(ffRes.status()).toBe(204);
    const tickRes = await ff.post('/api/v1/test-support/data-erasure/tick');
    expect(tickRes.status()).toBe(204);
  } finally {
    await ff.dispose();
  }

  // The employee row was anonymised — inspect via HR.
  const listRes = await hr.ctx.get('/api/v1/admin/data-erasure', {
    headers: { Authorization: `Bearer ${hr.accessToken}` },
  });
  expect(listRes.ok()).toBe(true);
  const list = (await listRes.json()) as {
    requests: Array<{ id: string; status: string; requesterEmail: string }>;
  };
  const target = list.requests.find((r) => r.id === created.id);
  expect(target).toBeDefined();
  expect(target!.status).toBe('EXECUTED');
  expect(target!.requesterEmail).toMatch(/@workpulse\.deleted$/);

  // Old credentials no longer authenticate — the throwaway user was
  // anonymised so their email/hash combo is dead.
  const relogin = await employee.ctx.post('/api/v1/auth/login', {
    data: {
      email: throwawayEmail,
      password: SEED_USERS.employee.password,
    },
  });
  expect(relogin.status()).toBe(401);

  await employee.ctx.dispose();
  await hr.ctx.dispose();
});
