import { expect, test, type APIRequestContext } from '@playwright/test';

import { SEED_USERS } from './fixtures/users';

/**
 * Fase 30b — Session management API surface.
 *
 * This suite talks directly to `/api/v1/auth/sessions/*`. We serialize
 * because each test mutates the target user's `RefreshToken` table
 * (adding rows via login, removing rows via revoke). Cross-test
 * bleeding is bounded by the seed reset in `global-setup.ts` — but
 * within a run, ordering matters.
 *
 * The tests need the SAME `APIRequestContext` for a given "session"
 * because Playwright's contexts carry cookies (and the `wp_refresh`
 * cookie is what marks a session as `isCurrent`). We deliberately do
 * NOT use `helpers/api.ts` here — that helper drops the cookie after
 * login. Instead we open contexts explicitly.
 */
test.describe.configure({ mode: 'serial' });

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

async function loginContext(
  role: keyof typeof SEED_USERS,
  userAgent?: string,
): Promise<{ ctx: APIRequestContext; accessToken: string }> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({
    baseURL: API_URL,
    ...(userAgent ? { extraHTTPHeaders: { 'user-agent': userAgent } } : {}),
  });
  const user = SEED_USERS[role];
  const res = await ctx.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  if (!res.ok()) {
    throw new Error(`login failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { accessToken: string };
  return { ctx, accessToken: body.accessToken };
}

async function listSessions(
  ctx: APIRequestContext,
  accessToken: string,
): Promise<Array<{ id: string; isCurrent: boolean; userAgent: string | null }>> {
  const res = await ctx.get('/api/v1/auth/sessions', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as {
    sessions: Array<{ id: string; isCurrent: boolean; userAgent: string | null }>;
  };
  return body.sessions;
}

test('GET /auth/sessions lists every ACTIVE session and marks the caller as isCurrent', async () => {
  const first = await loginContext('employee', 'e2e-agent/session-list-1');
  const second = await loginContext('employee', 'e2e-agent/session-list-2');

  try {
    const rows = await listSessions(first.ctx, first.accessToken);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const current = rows.filter((r) => r.isCurrent);
    expect(current).toHaveLength(1);
    // The caller's UA must be attached to their own row.
    expect(current[0]?.userAgent).toBe('e2e-agent/session-list-1');
    // And the other login shows up but is NOT flagged current from this ctx.
    const otherAgent = rows.find((r) => r.userAgent === 'e2e-agent/session-list-2');
    expect(otherAgent).toBeDefined();
    expect(otherAgent?.isCurrent).toBe(false);
  } finally {
    await first.ctx.dispose();
    await second.ctx.dispose();
  }
});

test('DELETE /auth/sessions/:id revokes another device without touching the current one', async () => {
  const primary = await loginContext('employee', 'e2e-agent/kill-target-primary');
  const target = await loginContext('employee', 'e2e-agent/kill-target-victim');

  try {
    const rows = await listSessions(primary.ctx, primary.accessToken);
    const victim = rows.find((r) => r.userAgent === 'e2e-agent/kill-target-victim');
    expect(victim).toBeDefined();
    expect(victim?.isCurrent).toBe(false);

    const kill = await primary.ctx.delete(
      `/api/v1/auth/sessions/${victim?.id ?? ''}`,
      { headers: { Authorization: `Bearer ${primary.accessToken}` } },
    );
    expect(kill.status()).toBe(204);

    // The primary session still refreshes cleanly.
    const refresh = await primary.ctx.post('/api/v1/auth/refresh');
    expect(refresh.ok()).toBe(true);

    // The victim's refresh cookie is now dead.
    const dead = await target.ctx.post('/api/v1/auth/refresh');
    expect(dead.status()).toBe(401);

    // And the row disappears from the list.
    const remaining = await listSessions(primary.ctx, primary.accessToken);
    expect(remaining.find((r) => r.id === victim?.id)).toBeUndefined();
  } finally {
    await primary.ctx.dispose();
    await target.ctx.dispose();
  }
});

test('DELETE /auth/sessions/:id 404s for a foreign session id', async () => {
  const attacker = await loginContext('employee', 'e2e-agent/attacker');
  const victim = await loginContext('supervisor', 'e2e-agent/foreign-victim');

  try {
    const victimRows = await listSessions(victim.ctx, victim.accessToken);
    const targetId = victimRows.find((r) => r.isCurrent)?.id;
    expect(targetId).toBeDefined();

    const attack = await attacker.ctx.delete(
      `/api/v1/auth/sessions/${targetId ?? ''}`,
      { headers: { Authorization: `Bearer ${attacker.accessToken}` } },
    );
    expect(attack.status()).toBe(404);
    const body = await attack.json();
    expect(body.code).toBe('SESSION_NOT_FOUND');

    // Supervisor's session is untouched.
    const stillAlive = await victim.ctx.post('/api/v1/auth/refresh');
    expect(stillAlive.ok()).toBe(true);
  } finally {
    await attacker.ctx.dispose();
    await victim.ctx.dispose();
  }
});

test('DELETE /auth/sessions/:id kills the caller\'s own session (isCurrent branch)', async () => {
  const kill = await loginContext('employee', 'e2e-agent/self-destruct');
  try {
    const rows = await listSessions(kill.ctx, kill.accessToken);
    const current = rows.find((r) => r.isCurrent);
    expect(current).toBeDefined();

    const res = await kill.ctx.delete(
      `/api/v1/auth/sessions/${current?.id ?? ''}`,
      { headers: { Authorization: `Bearer ${kill.accessToken}` } },
    );
    expect(res.status()).toBe(204);

    const dead = await kill.ctx.post('/api/v1/auth/refresh');
    expect(dead.status()).toBe(401);
  } finally {
    await kill.ctx.dispose();
  }
});

test('POST /auth/sessions/revoke-others sweeps everything except the current session', async () => {
  const primary = await loginContext('employee', 'e2e-agent/keep-alive');
  const sacrificial = [
    await loginContext('employee', 'e2e-agent/burn-1'),
    await loginContext('employee', 'e2e-agent/burn-2'),
    await loginContext('employee', 'e2e-agent/burn-3'),
  ];

  try {
    const before = await listSessions(primary.ctx, primary.accessToken);
    const currentBefore = before.find((r) => r.isCurrent);
    expect(currentBefore).toBeDefined();

    const res = await primary.ctx.post('/api/v1/auth/sessions/revoke-others', {
      headers: { Authorization: `Bearer ${primary.accessToken}` },
    });
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { revokedCount: number };
    expect(body.revokedCount).toBeGreaterThanOrEqual(sacrificial.length);

    // Primary lives.
    const refresh = await primary.ctx.post('/api/v1/auth/refresh');
    expect(refresh.ok()).toBe(true);

    // Every sacrificial session is dead.
    for (const s of sacrificial) {
      const dead = await s.ctx.post('/api/v1/auth/refresh');
      expect(dead.status()).toBe(401);
    }

    // Only the current row remains in the list.
    const after = await listSessions(primary.ctx, primary.accessToken);
    expect(after).toHaveLength(1);
    expect(after[0]?.isCurrent).toBe(true);
  } finally {
    await primary.ctx.dispose();
    for (const s of sacrificial) await s.ctx.dispose();
  }
});

test('GET /auth/sessions requires authentication', async () => {
  const { request } = await import('@playwright/test');
  const anon = await request.newContext({ baseURL: API_URL });
  try {
    const res = await anon.get('/api/v1/auth/sessions');
    expect(res.status()).toBe(401);
  } finally {
    await anon.dispose();
  }
});

test('DELETE /auth/sessions/:id requires authentication', async () => {
  const { request } = await import('@playwright/test');
  const anon = await request.newContext({ baseURL: API_URL });
  try {
    const res = await anon.delete('/api/v1/auth/sessions/some-id');
    expect(res.status()).toBe(401);
  } finally {
    await anon.dispose();
  }
});
