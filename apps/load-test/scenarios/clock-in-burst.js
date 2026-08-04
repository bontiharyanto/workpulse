// ============================================================================
// Scenario — Peak clock-in burst.
//
// Simulates 500 karyawan clock-in dalam window 60 detik pas jam 08:00.
// Ini adalah beban puncak realistis untuk 1 tenant menengah (500 karyawan).
//
// Metrik yang dijaga:
//   - p95 latency <= SLO.write_p95_ms
//   - error rate  <= SLO.error_rate_max
//
// Menganggap payload clock-in EMPLOYEE — geofence check ada di server side
// jadi kita kirim koordinat DALAM radius supaya request lolos validasi.
//
// Prerequisite:
//   - Seed 500 EMPLOYEE users di tenant target dan siapkan JWT-nya di file
//     `apps/load-test/data/jwts.json` (array of accessToken).
//   - Atau, lewatkan `EMPLOYEE_JWT=<one-token>` dan reuse token yang sama
//     (kurang realistis karena connection-reuse tapi cukup untuk baseline).
//
// Run:
//   $ k6 run \
//       -e API_URL=https://staging.workpulse.local \
//       -e EMPLOYEE_JWT=eyJhbGc... \
//       apps/load-test/scenarios/clock-in-burst.js
// ============================================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Rate, Trend } from 'k6/metrics';

import { API_URL, API_PREFIX, EMPLOYEE_JWT, SLO, apiHeaders } from '../lib/config.js';

// Custom metrics — appear in the terminal + CI report.
const clockInErrors = new Rate('clock_in_errors');
const clockInLatency = new Trend('clock_in_latency_ms', true);

// Load JWTs from disk if available; otherwise fall back to a single token.
const tokens = new SharedArray('employee_jwts', function () {
  try {
    return open('../data/jwts.json') ? JSON.parse(open('../data/jwts.json')) : [];
  } catch (_e) {
    return [];
  }
});

export const options = {
  scenarios: {
    burst: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { target: 20, duration: '15s' },  // warm up
        { target: 250, duration: '30s' }, // ramp to peak: ~500 requests dalam 60s
        { target: 250, duration: '30s' }, // sustain peak
        { target: 0, duration: '15s' },   // cool down
      ],
    },
  },
  thresholds: {
    // Global.
    http_req_failed: [`rate<${SLO.error_rate_max}`],
    // Endpoint-specific (via URL name + tag).
    clock_in_errors: ['rate<0.02'],
    clock_in_latency_ms: [`p(95)<${SLO.write_p95_ms}`],
  },
};

export default function () {
  const token = pickToken();
  if (!token) {
    // No JWT provided — this is an environment mis-config, fail loudly.
    check(null, { 'employee JWT provided': () => false });
    return;
  }

  const payload = JSON.stringify({
    // Coordinates inside a typical Jakarta geofence (Bundaran HI area).
    // The seed tenant should have a matching geofence configured.
    latitude: -6.19511 + Math.random() * 0.0004,
    longitude: 106.82302 + Math.random() * 0.0004,
    accuracy: 12,
    // Client timestamp — server clock authority still wins.
    clientTimestamp: new Date().toISOString(),
  });

  const res = http.post(
    `${API_URL}${API_PREFIX}/attendance/clock-in`,
    payload,
    {
      headers: apiHeaders(token),
      tags: { endpoint: 'attendance.clock_in' },
    },
  );

  const ok = check(res, {
    // 200 = success. 409 = "already clocked in" — acceptable during idempotency
    // check because k6 VUs reuse tokens.
    'clock-in ok': (r) => r.status === 200 || r.status === 409,
  });
  clockInErrors.add(!ok);
  clockInLatency.add(res.timings.duration);

  // Pace the loop slightly so we don't hammer the same connection socket.
  sleep(0.1 + Math.random() * 0.4);
}

function pickToken() {
  if (tokens.length > 0) {
    return tokens[Math.floor(Math.random() * tokens.length)];
  }
  return EMPLOYEE_JWT;
}
