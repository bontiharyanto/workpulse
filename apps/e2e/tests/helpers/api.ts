import { request, type APIRequestContext } from '@playwright/test';

import { SEED_USERS, type SeedUserKey } from '../fixtures/users';

/**
 * API base URL used by the E2E workspace. Mirrors `playwright.config.ts` —
 * the two files must agree, so we duplicate the env var read rather than
 * import the config (which would drag in the whole Playwright type graph
 * into the tests).
 */
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

export interface AuthenticatedApi {
  /** Prebuilt request context with `Authorization: Bearer <token>` baked in. */
  api: APIRequestContext;
  /** Access token used to build the request context; useful for manual retries. */
  accessToken: string;
  /** Convenience — full base URL including versioned prefix. */
  baseUrl: string;
}

/**
 * Log in as a seed user via the JSON auth endpoint and return an
 * `APIRequestContext` that carries the bearer token on every request.
 *
 * We prefer request contexts over UI login for API-level assertions
 * (RBAC-gated endpoints, idempotency probes) — it keeps those specs
 * fast + resistant to unrelated UI churn.
 */
export async function authenticateApi(
  key: SeedUserKey,
): Promise<AuthenticatedApi> {
  const user = SEED_USERS[key];
  const login = await request.newContext({ baseURL: API_URL });
  const res = await login.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  if (!res.ok()) {
    throw new Error(
      `authenticateApi(${key}) failed: ${res.status()} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { accessToken?: string };
  await login.dispose();
  if (!body.accessToken) {
    throw new Error(`authenticateApi(${key}): login response missing accessToken`);
  }
  const api = await request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: {
      Authorization: `Bearer ${body.accessToken}`,
    },
  });
  return { api, accessToken: body.accessToken, baseUrl: `${API_URL}/api/v1` };
}
