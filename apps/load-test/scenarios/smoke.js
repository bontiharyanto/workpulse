// ============================================================================
// Smoke test — 1 VU, 30 s, hits /health + /health/deep.
//
// Purpose: sanity-check that k6 is wired to the correct target and the API is
// reachable. Runs before every real load run in the CI pipeline.
//
//   $ k6 run --vus 1 --duration 30s apps/load-test/scenarios/smoke.js
// ============================================================================

import http from 'k6/http';
import { check, sleep } from 'k6';

import { API_URL, API_PREFIX, apiHeaders } from '../lib/config.js';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const shallow = http.get(`${API_URL}${API_PREFIX}/health`, {
    headers: apiHeaders(),
    tags: { endpoint: 'health.shallow' },
  });
  check(shallow, {
    'shallow health 200': (r) => r.status === 200,
    'shallow health db=up': (r) => r.json().db === 'up',
  });

  const deep = http.get(`${API_URL}${API_PREFIX}/health/deep`, {
    headers: apiHeaders(),
    tags: { endpoint: 'health.deep' },
  });
  check(deep, {
    'deep health 200 or 503': (r) => r.status === 200 || r.status === 503,
    'deep health has status': (r) => typeof r.json().status === 'string',
  });

  sleep(1);
}
