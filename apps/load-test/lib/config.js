// ============================================================================
// Workpulse — Load-test shared config.
//
// Reads runtime knobs from k6 env (`k6 run -e API_URL=https://staging.example.com …`)
// with sensible defaults for a local `docker compose up -d` topology.
// ============================================================================

export const API_URL = __ENV.API_URL || 'http://localhost:4000';
export const API_PREFIX = '/api/v1';

// Test tenant + user pool. These MUST exist in the target env (seeded via
// `apps/api/src/test-support/*` or a dedicated seed script). Never target
// production — hitting production with a real user token would corrupt
// attendance data.
export const TEST_TENANT_ID = __ENV.TEST_TENANT_ID || 'seed-tenant-1';

// Pre-issued JWT for a load-test user with `EMPLOYEE` role (limited blast radius).
// Generated with `POST /api/v1/auth/login` before the run and injected via env.
// If empty, scripts assume the endpoint is unauthenticated OR they will attempt
// to log in during the setup() phase.
export const EMPLOYEE_JWT = __ENV.EMPLOYEE_JWT || '';
export const HR_JWT = __ENV.HR_JWT || '';

// Latency SLO targets — used as `thresholds` in individual scenarios so a
// regression fails the k6 exit code (CI catches it).
export const SLO = {
  // p95 for GETs
  read_p95_ms: Number(__ENV.SLO_READ_P95_MS || 300),
  // p95 for writes (clock-in, form submit)
  write_p95_ms: Number(__ENV.SLO_WRITE_P95_MS || 600),
  // p95 for exports (async, higher tolerance)
  export_p95_ms: Number(__ENV.SLO_EXPORT_P95_MS || 5000),
  // Global error budget
  error_rate_max: Number(__ENV.SLO_ERROR_RATE_MAX || 0.01), // 1%
};

export function apiHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    // Tag every request so we can filter in the logs if the load test
    // accidentally hits prod.
    'X-Load-Test': 'workpulse-k6',
  };
}
