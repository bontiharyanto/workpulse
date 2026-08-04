// ============================================================================
// Scenario — End-to-end mixed workload baseline.
//
// Aggregates the three individual scenarios into one run, weighted by expected
// production traffic mix:
//
//   ~70%  reads (dashboard, list endpoints)
//   ~28%  writes (clock-in / clock-out / leave submit)
//   ~2%   exports (payroll async)
//
// Purpose: single number to compare release-over-release. Any regression in
// this file's summary is the canary for perf tickets.
//
// Run:
//   $ EMPLOYEE_JWT=... HR_JWT=... k6 run apps/load-test/scenarios/baseline.js
// ============================================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

import { API_URL, API_PREFIX, EMPLOYEE_JWT, HR_JWT, SLO, apiHeaders } from '../lib/config.js';

const errors = new Rate('baseline_errors');
const readTimings = new Trend('baseline_read_ms', true);
const writeTimings = new Trend('baseline_write_ms', true);
const exportTimings = new Trend('baseline_export_ms', true);

export const options = {
  scenarios: {
    mixed: {
      executor: 'constant-vus',
      vus: 30,
      duration: '5m',
    },
  },
  thresholds: {
    http_req_failed: [`rate<${SLO.error_rate_max}`],
    baseline_errors: ['rate<0.02'],
    baseline_read_ms: [`p(95)<${SLO.read_p95_ms}`],
    baseline_write_ms: [`p(95)<${SLO.write_p95_ms}`],
    baseline_export_ms: [`p(95)<${SLO.export_p95_ms}`],
  },
};

export default function () {
  const dice = Math.random();

  if (dice < 0.02) {
    doExport();
  } else if (dice < 0.3) {
    doWrite();
  } else {
    doRead();
  }
  sleep(0.5 + Math.random() * 2);
}

function doRead() {
  if (!HR_JWT && !EMPLOYEE_JWT) return;
  const token = HR_JWT || EMPLOYEE_JWT;
  const endpoints = [
    '/analytics/dashboard?range=30d',
    '/admin/timesheets?status=PENDING_HR&page=1',
    '/me',
    '/notifications?page=1',
  ];
  const path = endpoints[Math.floor(Math.random() * endpoints.length)];
  const res = http.get(`${API_URL}${API_PREFIX}${path}`, {
    headers: apiHeaders(token),
    tags: { endpoint: path.split('?')[0] },
  });
  errors.add(!(res.status >= 200 && res.status < 300));
  readTimings.add(res.timings.duration);
}

function doWrite() {
  if (!EMPLOYEE_JWT) return;
  const res = http.post(
    `${API_URL}${API_PREFIX}/attendance/clock-in`,
    JSON.stringify({
      latitude: -6.19511 + Math.random() * 0.0004,
      longitude: 106.82302 + Math.random() * 0.0004,
      accuracy: 12,
      clientTimestamp: new Date().toISOString(),
    }),
    {
      headers: apiHeaders(EMPLOYEE_JWT),
      tags: { endpoint: 'attendance.clock_in' },
    },
  );
  const ok = res.status === 200 || res.status === 409;
  errors.add(!ok);
  writeTimings.add(res.timings.duration);
}

function doExport() {
  if (!HR_JWT) return;
  const res = http.get(`${API_URL}${API_PREFIX}/admin/timesheets/periods/latest`, {
    headers: apiHeaders(HR_JWT),
    tags: { endpoint: 'timesheet.period.latest' },
  });
  if (res.status !== 200) {
    errors.add(true);
    return;
  }
  const periodId = (res.json() || {}).id;
  if (!periodId) return;

  const exportRes = http.post(
    `${API_URL}${API_PREFIX}/admin/timesheets/exports`,
    JSON.stringify({ periodId, format: 'CSV', mode: 'SUMMARY' }),
    {
      headers: apiHeaders(HR_JWT),
      timeout: '60s',
      tags: { endpoint: 'timesheet.export.create' },
    },
  );
  errors.add(exportRes.status !== 200);
  exportTimings.add(exportRes.timings.duration);
}
