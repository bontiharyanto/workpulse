# ADR-0015 — E2E Test Hygiene: Destructive Global Reset + Per-Test Cleanup

**Status:** Accepted — 2026-08-02
**Related:** ADR-0011 (attendance correction), ADR-0014 (mustChangePassword), `apps/e2e/**`

---

## Context

The Playwright E2E suite (`apps/e2e/`) began flaking as soon as it grew past
the auth + leave happy path. Six specs regressed once the DB accumulated
state across dev iterations:

| Spec | Signature | Root cause |
|---|---|---|
| `leave.spec.ts` | `option[value!=""]` throws `SyntaxError` in Chromium | jQuery-only selector; not valid CSS |
| `leave.spec.ts` | `POST /leave` → 409 `OVERLAPPING_REQUEST` on rerun | Previous run left an APPROVED leave for `daysFromToday(7)..daysFromToday(8)`; APPROVED is terminal → employee cannot cancel it |
| `overtime.spec.ts` | Employee submit row not visible; supervisor `Setujui` button not clickable | (a) prior run left an APPROVED overtime for `nearestPastWeekday(1)` → 409 `DUPLICATE_WORK_DATE`; (b) UI evolved to a two-step disclosure (`Putuskan` → `Setujui`) but the test only clicked `Setujui` |
| `notification-preferences.spec.ts` | `POST /overtime` → 400 `VALIDATION_FAILED` | (a) hardcoded `workDate: '2026-07-15'` fell outside the 14-day submit window as the calendar advanced; (b) payload used stale `startAt`/`endAt` fields instead of the current `hours` DTO field |
| `attendance-correction.spec.ts` | `expect(created?.clockInAt).toContain(DATE_HAPPY)` → `Received: undefined` | Test compared `DTO.workDate` (`toISOString()` → full ISO with `T00:00:00Z` suffix) against a YYYY-MM-DD literal via `===`; the strict-equal predicate never matched, so `.find()` returned undefined |
| `attendance-hr-dashboard.spec.ts` | `strict mode violation: locator('div', { has: ... }).first().locator('p.text-2xl') resolved to 8 elements` | Outer `locator('div', { has: text })` matches the leaf StatCard AND every ancestor grid container; `.first()` picked the outermost, which contained all 8 stat cards |
| `attendance-supervisor-view.spec.ts` | `getByRole('cell', { name: 'Employee One', exact: true })` → not visible | Roster's "Nama" cell stacks `fullName` and `email` inside two divs, so the cell's accessible name is `Employee One employee@acme.test`; `exact: true` on the fullName alone could not match |

None of these are Fase 27 (`mustChangePassword`) regressions — every one
predates that shipment. But they blocked the "green E2E gate" that Fase 27
was validated against, so this ADR documents the hygiene fixes together.

## Decision

Adopt three simultaneous conventions:

### 1. Global setup does a **destructive reset** every full run

Previously `apps/e2e/global-setup.ts` ran `prisma migrate deploy` + `prisma
db seed`. Both are non-destructive: the seed is upsert-based, but leave /
overtime rows accumulate under user IDs the seed also upserts. The suite
approves those rows into terminal states from which the caller-side
`/cancel` endpoints refuse to move them — leaving a permanent trap.

New behaviour:

```ts
// apps/e2e/global-setup.ts
if (process.env.WORKPULSE_E2E_SKIP_MIGRATE === '1') return;
runInApi('prisma:migrate:reset --force');
await waitForApiHealth();
```

`prisma migrate reset --force` drops the schema, re-applies every
migration, and re-invokes the seed — a single command that guarantees a
deterministic starting state. `WORKPULSE_E2E_SKIP_MIGRATE=1` still opts
out for developers iterating on a single spec against a known-good DB.

### 2. Post-reset **`waitForApiHealth`** with N-consecutive-OK

`prisma migrate reset` regenerates `node_modules/@prisma/client`, which
NestJS `nest start --watch` detects as a file change and reloads the API
process against. If the first Playwright test kicks off during that
~1s reload window it fails with `ECONNREFUSED :4000`.

The fix is a health-probe loop that requires **3 consecutive successful
`GET /api/v1/health`** responses spaced 250 ms apart. A single 200
answer isn't sufficient because the socket stays open just long enough
to service one probe before the hot-reload closes it. Two more probes
250 ms later flushes the reload window.

### 3. Per-test **pre-flight cleanup helpers**

New file `apps/e2e/tests/helpers/cleanup.ts` ships two idempotent
helpers, called from `test.beforeEach` / body:

- `cancelOvertimeFor(api, workDate)` — cancels every non-terminal
  overtime the caller owns on that `workDate`. Wired into
  `overtime.spec.ts` and `notification-preferences.spec.ts`.
- `cancelLeaveOverlapping(api, startDate, endDate)` — cancels every
  non-terminal leave the caller owns overlapping the window. Available
  for future specs.

These handle the developer inner-loop case where a spec is rerun
individually (via `WORKPULSE_E2E_SKIP_MIGRATE=1`) between full-suite
resets. APPROVED rows still cannot be cancelled from these helpers
(terminal state) — those force a destructive reset by design.

## Consequences

- **CI unaffected.** CI already provisions a fresh Postgres per job,
  so the added `migrate reset` in `global-setup` is a no-op-equivalent
  (it drops an empty schema, re-applies migrations, seeds — same result
  as the prior `migrate deploy + seed`).
- **Local dev slightly slower.** Full E2E run now spends an extra
  ~2 s in setup (`reset` vs. `deploy`). Acceptable given the trade for
  determinism.
- **UI tests remain valid across UI evolution** thanks to two forced
  changes:
  - `attendance-supervisor-view.spec.ts` and other roster cell probes
    switched from `getByRole('cell', { name, exact: true })` to
    `getByRole('cell').filter({ hasText: name })` — the correct
    Playwright idiom for cells that pack `fullName + email` in one
    `<td>`.
  - `attendance-hr-dashboard.spec.ts` anchors on the label element
    (`getByText('Total karyawan', { exact: true })`) and hops to its
    sibling `<p>` via XPath — resilient to the StatCard being nested
    inside another grid wrapper without leaking DOM structure knowledge.

## Verification

Full E2E suite: **91 passed / 0 failed** after all fixes
(`pnpm --filter @workpulse/e2e test` locally, matching CI's `e2e` job).

Individual spec reruns are idempotent — each spec that mutates
non-terminal state pre-cleans via `helpers/cleanup.ts`. Specs that
mutate to terminal states (leave APPROVED, overtime APPROVED) rely on
the global destructive reset and will fail predictably if re-run
without one — documented in `docs/TESTING.md`.

## Alternatives considered

1. **Add a SUPER_ADMIN "purge" endpoint** that soft-deletes any
   LeaveRequest / OvertimeRequest by tag. Rejected: adding production
   surface just to serve tests violates our "no test-only endpoints"
   convention and would need its own RBAC + audit story.
2. **Direct Prisma access from E2E workspace.** Rejected: pulls the
   Prisma client into `apps/e2e/`, doubling dep footprint and needing
   its own generation step. Reset-per-run achieves the same end state.
3. **Randomize dates per run** (`daysFromToday(7 + Math.random()*20)`).
   Rejected: only papers over the accumulation; long-running dev DBs
   would still eventually collide, and unstable date bases make
   payroll-cutoff assertions fragile.
