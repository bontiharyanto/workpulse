// ============================================================================
// Scenario — Timesheet export throughput.
//
// Payroll cycle nyata: HR admin men-trigger 3–5 export XLSX besar per hari.
// Setiap export bisa mengagregasi 500+ karyawan × 22 hari kerja = 11k rows.
//
// Kita test:
//   - Berapa concurrent export yang bisa API handle tanpa OOM?
//   - Latency p95 untuk generate + hash + audit-log.
//   - Signed download URL creation di path yang berbeda.
//
// Karena export adalah long-running (5–30s per request), pakai VU rendah
// tetapi jaga wait time realistis.
//
// Run:
//   $ HR_JWT=eyJhbGc... k6 run apps/load-test/scenarios/timesheet-export.js
// ============================================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

import { API_URL, API_PREFIX, HR_JWT, SLO, apiHeaders } from '../lib/config.js';

const exportErrors = new Rate('export_errors');
const exportLatency = new Trend('export_latency_ms', true);

export const options = {
  scenarios: {
    payroll_cycle: {
      executor: 'constant-vus',
      vus: 5,          // sedikit tapi lama — mensimulasikan HR menekan tombol Export
      duration: '2m',
    },
  },
  thresholds: {
    http_req_failed: [`rate<0.02`],
    export_errors: ['rate<0.02'],
    export_latency_ms: [`p(95)<${SLO.export_p95_ms}`],
  },
};

export default function () {
  if (!HR_JWT) {
    check(null, { 'HR JWT provided': () => false });
    return;
  }

  // Assume periodId is discoverable from a small helper endpoint. In the pilot
  // seed, `/admin/timesheets/periods/latest` returns one. Cache-friendly.
  const periodRes = http.get(
    `${API_URL}${API_PREFIX}/admin/timesheets/periods/latest`,
    { headers: apiHeaders(HR_JWT), tags: { endpoint: 'timesheet.period.latest' } },
  );
  if (periodRes.status !== 200) {
    check(periodRes, { 'periods/latest 200': (r) => r.status === 200 });
    return;
  }
  const periodId = (periodRes.json() || {}).id;
  if (!periodId) return;

  const body = JSON.stringify({
    periodId,
    format: Math.random() < 0.5 ? 'CSV' : 'XLSX',
    mode: Math.random() < 0.5 ? 'SUMMARY' : 'DETAIL',
  });

  const res = http.post(
    `${API_URL}${API_PREFIX}/admin/timesheets/exports`,
    body,
    {
      headers: apiHeaders(HR_JWT),
      timeout: '60s',
      tags: { endpoint: 'timesheet.export.create' },
    },
  );

  const ok = check(res, {
    'export 200': (r) => r.status === 200,
    'export has SHA256': (r) => !!(r.json() && r.json().payloadSha256),
  });
  exportErrors.add(!ok);
  exportLatency.add(res.timings.duration);

  // 30–60s think time — realistic payroll flow: HR downloads → reviews → next.
  sleep(30 + Math.random() * 30);
}
