// ============================================================================
// Workpulse — Load-test auth helper.
//
// Exchanges a (loadtest) email/password for a JWT via /auth/login. Result is
// returned to the k6 setup() phase and passed as `data` into every VU.
// ============================================================================

import http from 'k6/http';
import { check, fail } from 'k6';

import { API_URL, API_PREFIX, apiHeaders } from './config.js';

/**
 * Log in and return `{ accessToken, refreshToken }`. Aborts the whole run on
 * failure — a broken login means the entire scenario is invalid.
 */
export function login(email, password) {
  const url = `${API_URL}${API_PREFIX}/auth/login`;
  const res = http.post(
    url,
    JSON.stringify({ email, password }),
    { headers: apiHeaders(), tags: { endpoint: 'auth.login' } },
  );

  if (!check(res, { 'login 200': (r) => r.status === 200 })) {
    fail(`load-test setup: cannot log in as ${email} — status=${res.status} body=${res.body}`);
  }

  const body = res.json();
  if (!body || !body.accessToken) {
    fail(`load-test setup: /auth/login returned no accessToken (got ${JSON.stringify(body).slice(0, 200)})`);
  }
  return body;
}
