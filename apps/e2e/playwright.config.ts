import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

/**
 * Playwright configuration for the Workpulse E2E suite.
 *
 * Design choices:
 *
 * - **Managed webServers.** Playwright spawns both the API and Web servers
 *   itself so a fresh developer can run `pnpm e2e` after `docker compose up
 *   -d postgres` without extra orchestration. `reuseExistingServer` is on
 *   locally so devs can keep `pnpm dev` running in a side terminal and
 *   Playwright will connect to those servers instead of double-booting.
 *
 * - **Prisma reset + seed** runs in a `globalSetup` hook (see
 *   `./global-setup.ts`). It happens exactly once per test run — individual
 *   tests are responsible for staying independent of each other by working
 *   with data they create themselves (leave requests, overtime, etc.) and
 *   NOT the seed state directly (except for user credentials).
 *
 * - **Chromium only.** MVP coverage — we can add Firefox/WebKit later if
 *   flake numbers stay green. Adding a second browser doubles CI cost, and
 *   most Workpulse UX bugs surface in Chromium first.
 *
 * - **Trace + video on first retry.** Locally the test that failed once is
 *   usually the one you want to inspect; recording only on retry keeps
 *   green runs cheap.
 */

const REPO_ROOT = resolve(__dirname, '..', '..');
const CI = !!process.env.CI;

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  fullyParallel: false, // multi-role tests coordinate on shared server state
  workers: 1,           // avoid Prisma connection contention on tiny CI runners
  forbidOnly: CI,
  retries: CI ? 2 : 0,

  reporter: CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['list'], ['html', { open: 'never' }]],

  globalSetup: require.resolve('./global-setup.ts'),

  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      name: 'api',
      // Production build is faster to iterate on for CI (fewer file watchers).
      // Locally we still use `dev` to get incremental compilation.
      command: CI
        ? 'pnpm --filter @workpulse/api start:prod'
        : 'pnpm --filter @workpulse/api dev',
      cwd: REPO_ROOT,
      url: `${API_URL}/api/v1/health`,
      timeout: 120_000,
      reuseExistingServer: !CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: CI ? 'production' : (process.env.NODE_ENV ?? 'development'),
        // Bypass the login/reset/change-password throttlers — many E2E tests
        // authenticate multiple times inside a 60-second window and would
        // otherwise flake with 429s. This env is refused by env.validation.ts
        // when NODE_ENV=production, so it can only ever leak in dev/test.
        THROTTLER_DISABLED: 'true',
        // Disable MFA enrollment enforcement for HR / SUPER_ADMIN. The seed
        // users log in dozens of times per run; forcing enrollment on
        // every one would either fail every test or require adding a
        // pre-baked TOTP secret to the seed. The dedicated `mfa.spec.ts`
        // exercises enrollment explicitly, so we're covered. The env
        // validator refuses `false` when NODE_ENV=production.
        MFA_ENFORCE_HR_ADMIN: 'false',
        // Fase 32e — allow the webhook worker to POST to the loopback
        // sink at http://localhost:4000/api/v1/test-support/webhook-sink.
        // Production must keep this at the safe default (true); the
        // env validator refuses NODE_ENV=production alongside this
        // flag when combined with the other test-only knobs above.
        WEBHOOK_BLOCK_PRIVATE_IPS: 'false',
      },
    },
    {
      name: 'web',
      command: CI
        ? 'pnpm --filter @workpulse/web start'
        : 'pnpm --filter @workpulse/web dev',
      cwd: REPO_ROOT,
      url: WEB_URL,
      timeout: 120_000,
      reuseExistingServer: !CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
