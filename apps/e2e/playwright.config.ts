import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

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
  // Local dev-mode boots Next.js/Nest with lazy compilation; multi-role
  // serial flows (leave, overtime) can spend 20+ seconds compiling
  // routes on first hit. CI uses `start` (production build) and needs
  // less headroom but paying the extra budget is cheap on CI too.
  timeout: CI ? 30_000 : 60_000,
  expect: { timeout: 5_000 },

  fullyParallel: false, // multi-role tests coordinate on shared server state
  workers: 1, // avoid Prisma connection contention on tiny CI runners
  forbidOnly: CI,
  // Local dev-mode has an intermittent first-request flake where the
  // browser gets `Failed to fetch` on the very first `/auth/login`
  // because Nest `--watch` reloads the Prisma client mid-response
  // right after `prisma migrate reset` in global-setup. One retry is
  // enough to shake the flake off in practice.
  retries: CI ? 2 : 1,

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
    // Force `prefers-reduced-motion: reduce`. Motion primitives
    // (CountUp, FadeIn, StaggerList, HoverLift, PageTransition) all
    // fall back to non-animated renders when this is set, which
    // eliminates race conditions where a test reads a value mid-
    // animation (e.g. `expect(total).toBe(4)` while `<CountUp>` is
    // still animating 0 → 4). Nested under `contextOptions` because
    // `@playwright/test` at this version only types the option on
    // `BrowserContextOptions`.
    contextOptions: { reducedMotion: 'reduce' },
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
      //
      // Note: use `start` (not `start:prod`) because `start:prod` hard-codes
      // `NODE_ENV=production` on the shell command line, which overrides any
      // value passed via `env` below. `start` calls `node dist/main.js`
      // directly, so our `NODE_ENV=test` in `env` wins.
      command: CI ? 'pnpm --filter @workpulse/api start' : 'pnpm --filter @workpulse/api dev',
      cwd: REPO_ROOT,
      url: `${API_URL}/api/v1/health`,
      timeout: 120_000,
      reuseExistingServer: !CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        // NODE_ENV=test in every mode. Earlier this branched to `production`
        // for `CI=true` under the theory that the E2E harness should
        // exercise the exact runtime configuration that ships. In practice
        // this contradicts the test-only env knobs below — `env.validation`
        // rejects `THROTTLER_DISABLED=true` and `WEBHOOK_BLOCK_PRIVATE_IPS=false`
        // when `NODE_ENV=production`, and Playwright's webServer fails to boot
        // on CI. `test` still runs the compiled `dist/` output (see the
        // `start:prod` command below) so we ARE exercising the production
        // build artefact; only the runtime posture is loosened for test
        // pragmatism.
        //
        // MFA_ENFORCE_HR_ADMIN was also historically rejected under
        // production but is now allowed at any value (MVP opt-in). We keep
        // it pinned here for determinism regardless of the ambient default.
        NODE_ENV: 'test',
        // Bypass the login/reset/change-password throttlers — many E2E tests
        // authenticate multiple times inside a 60-second window and would
        // otherwise flake with 429s.
        THROTTLER_DISABLED: 'true',
        // Disable MFA enrollment enforcement for HR / SUPER_ADMIN. The seed
        // users log in dozens of times per run; forcing enrollment on
        // every one would either fail every test or require adding a
        // pre-baked TOTP secret to the seed. The dedicated `mfa.spec.ts`
        // exercises enrollment explicitly, so we're covered.
        MFA_ENFORCE_HR_ADMIN: 'false',
        // Fase 32e — allow the webhook worker to POST to the loopback
        // sink at http://localhost:4000/api/v1/test-support/webhook-sink.
        // Production must keep this at the safe default (true).
        WEBHOOK_BLOCK_PRIVATE_IPS: 'false',
      },
    },
    {
      name: 'web',
      command: CI ? 'pnpm --filter @workpulse/web start' : 'pnpm --filter @workpulse/web dev',
      cwd: REPO_ROOT,
      url: WEB_URL,
      timeout: 120_000,
      reuseExistingServer: !CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
