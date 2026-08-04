// ============================================================================
// Scenario — Dashboard read load.
//
// Simulates HR viewing:
//   1. /analytics/dashboard  (executive KPI, cached)
//   2. /admin/timesheets      (list)
//   3. /admin/leave/requests  (list)
//
// Target: 30–50 concurrent readers untuk stress-test cache layer + Prisma
// query plans. Realistic untuk 1–5 tenant pilot dengan multi-user HR team.
//
// Run:
//   $ HR_JWT=eyJhbGc... k6 run apps/load-test/scenarios/dashboard-read.js
// ============================================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

import { API_URL, API_PREFIX, HR_JWT, SLO, apiHeaders } from '../lib/config.js';

const readErrors = new Rate('dashboard_errors');
const readLatency = new Trend('dashboard_latency_ms', true);

export const options = {
  scenarios: {
    steady: {
      executor: 'constant-vus',
      vus: 40,
      duration: '3m',
    },
  },
  thresholds: {
    http_req_failed: [`rate<${SLO.error_rate_max}`],
    dashboard_errors: ['rate<0.01'],
    dashboard_latency_ms: [`p(95)<${SLO.read_p95_ms}`],
  },
};

const ENDPOINTS = [
  '/analytics/dashboard?range=30d',
  '/admin/timesheets?status=PENDING_HR&page=1&pageSize=20',
  '/admin/leave/requests?status=PENDING&page=1&pageSize=20',
  '/admin/attendance/today',
  '/analytics/reports/summary?metric=ATTENDANCE_ON_TIME_RATE&window=30',
];

export default function () {
  if (!HR_JWT) {
    check(null, { 'HR JWT provided': () => false });
    return;
  }

  const path = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
  const res = http.get(
    `${API_URL}${API_PREFIX}${path}`,
    {
      headers: apiHeaders(HR_JWT),
      tags: { endpoint: path.split('?')[0] },
    },
  );

  const ok = check(res, {
    'dashboard 2xx': (r) => r.status >= 200 && r.status < 300,
  });
  readErrors.add(!ok);
  readLatency.add(res.timings.duration);

  // Simulate the HR user pausing between clicks.
  sleep(1 + Math.random() * 3);
}
