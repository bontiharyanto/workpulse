import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Global setup — runs exactly once before the entire test suite, BEFORE
 * Playwright starts its webServers. Puts the DB into a deterministic
 * state by DROPPING every non-seed row via `prisma migrate reset
 * --force` and re-running the seed.
 *
 * Why destructive-reset (was: migrate deploy + seed):
 *
 *   The suite contains multi-role flows that end in APPROVED /
 *   terminal statuses that the caller-side APIs no longer allow to
 *   cancel (e.g. leave.spec.ts approves a leave for `daysFromToday(7)`
 *   → subsequent reruns hit `OVERLAPPING_REQUEST`, and overtime
 *   likewise leaves a row that traps `DUPLICATE_WORK_DATE`). A pure
 *   upsert-based seed cannot untangle those without a purge — and
 *   adding a "purge" admin endpoint just for tests would be a
 *   production-surface leak. Reset-per-run is the standard Playwright
 *   pattern for stateful E2E suites and matches how CI already runs
 *   (fresh Postgres each job).
 *
 * `prisma migrate reset --force` DROPs the schema, re-applies every
 * migration, and invokes `prisma db seed` on completion — so the two
 * previous commands collapse into one call.
 *
 * Setting `WORKPULSE_E2E_SKIP_MIGRATE=1` still skips this step — useful
 * when iterating a single test locally against a known-good DB, but be
 * aware that repeated full runs without reset will fail with the
 * overlap/dedup errors described above.
 */

const REPO_ROOT = resolve(__dirname, '..', '..');

export default async function globalSetup(): Promise<void> {
  if (process.env.WORKPULSE_E2E_SKIP_MIGRATE === '1') {
    // eslint-disable-next-line no-console
    console.log('[e2e:setup] WORKPULSE_E2E_SKIP_MIGRATE=1 — skipping migrate + reset');
    return;
  }

  // eslint-disable-next-line no-console
  console.log(
    '[e2e:setup] running prisma migrate reset --force (destructive) against DATABASE_URL',
  );

  runInApi('prisma:migrate:reset --force');

  // Reset regenerates `node_modules/@prisma/client` on disk which the API's
  // `nest start --watch` picks up and reloads. If the first test kicks off
  // during that ~1s reload window it fails with `ECONNREFUSED :4000`.
  // Wait for the API's health endpoint to be reachable AGAIN before
  // returning control to Playwright's test runner.
  await waitForApiHealth();
}

async function waitForApiHealth(): Promise<void> {
  const url = (process.env.E2E_API_URL ?? 'http://localhost:4000') + '/api/v1/health';
  const deadline = Date.now() + 60_000;
  // Require N consecutive successful health probes before proceeding. A
  // single 200 is not enough because `nest start --watch` reloads the
  // API mid-request when Prisma regenerates the client — the socket
  // stays open just long enough to answer ONE probe, then closes.
  //
  // 10 probes at 300ms apart = 3s of steady green before we hand
  // control back to the runner. Prior 3-probe setting was flaky on
  // machines where the Prisma-reload cascade takes longer to settle
  // (the very first `loginAs` of the run would surface `Failed to
  // fetch` in the browser).
  const REQUIRED_CONSECUTIVE_OK = 10;
  let consecutiveOk = 0;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        consecutiveOk += 1;
        if (consecutiveOk >= REQUIRED_CONSECUTIVE_OK) {
          // One extra breather after the streak lands — Next.js on the
          // web side may still be compiling its first request pipeline.
          await sleep(2000);
          return;
        }
      } else {
        consecutiveOk = 0;
      }
    } catch (err) {
      consecutiveOk = 0;
      lastErr = err;
    }
    await sleep(300);
  }
  throw new Error(
    `[e2e:setup] API did not become stably ready at ${url} within 60s: ${String(lastErr)}`,
  );
}

function runInApi(script: string): void {
  execSync(`pnpm --filter @workpulse/api ${script}`, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}
