# ADR-0039 — CI/CD Hardening (OPS-8)

- Status: Accepted
- Date: 2026-08-04
- Deciders: Workpulse Engineering + Ops
- Related: ADR-0036 (Beta Launch OPS baseline), ADR-0037 (Retention audit + tenant usage), ADR-0038 (Vendor register)

## Context

By the end of Milestone 6, Workpulse had:

- `ci.yml` running lint / typecheck / tests / E2E / Docker smoke on
  every PR.
- Dockerfiles for API + Web (`apps/{api,web}/Dockerfile`), a hardened
  `docker-compose.prod.yml`, and a manual `scripts/deploy.sh` playbook.
- A k6 load-test suite under `apps/load-test/` with SLO thresholds
  encoded, but no CI wiring to run them.
- Dependabot + CODEOWNERS + a PR template.

Three gaps kept the pipeline from being production-grade for the
SMB Indonesia pilot:

1. **No release pipeline.** Every deploy started with a maintainer
   running `docker build && docker push` locally. That is unauditable,
   racy against `main`, and impossible to reason about for supply-chain
   provenance.
2. **No security automation.** CVEs in `pnpm-lock.yaml` were caught
   only when a human ran `pnpm audit` by hand; no scheduled scan of
   the container images; no secret-string sweep across history.
3. **No load-test on demand.** k6 scripts existed but a fresh
   release could ship without ever exercising them, meaning the SLO
   baseline in `docs/OPS/PERFORMANCE.md` was aspirational rather than
   enforced.

Without closing these, the pilot's on-call would end up doing the
supply-chain work by hand during incidents.

## Decision

Ship four new workflows and tighten the existing one, plus a
`SECURITY.md`, structured issue templates, and a companion runbook.

### `release.yml` — cut a release on tag

- Triggers on `v*.*.*` (and `v*.*.*-*` for pre-release) tag pushes,
  plus manual dispatch with an explicit `tag` input.
- Guards with a `verify-tag` job that fails if the pushed tag doesn't
  match the root `package.json` `version`. Prevents "tag says v1.2.3,
  ships v1.1.9".
- Matrix `publish` (api / web) uses `docker/build-push-action@v6`
  with:
  - `platforms: linux/amd64` (target VPS is amd64; ARM tier deferred).
  - GHCR auth via built-in `GITHUB_TOKEN` with `packages: write`.
  - Metadata action generates `v1.2.3`, `1.2.3`, and `latest` (only
    on non-prerelease tags).
  - `provenance: mode=max` + `sbom: true`.
- `actions/attest-build-provenance@v1` attaches an SLSA v1 attestation
  to each image digest pushed to registry.
- A `smoke` job pulls the freshly-pushed images and boots the Web
  container against `/`. API smoke stays as a manifest inspection
  because the API runs `prisma migrate deploy` at boot and would need
  a real DB.
- `summary` composes a copy-pasteable "next steps" block into the
  workflow summary so the release manager gets the exact deploy
  command.

### `security.yml` — layered scanning

Three probes running on complementary triggers:

- **Trivy filesystem** (every PR + push + weekly + manual) — two
  passes: first uploads SARIF to the Security tab covering `HIGH,CRITICAL`,
  second gates on `CRITICAL` only (`exit-code: 1`).
- **`pnpm audit --prod --audit-level high`** (every PR + push) — dev
  deps ignored; a CVE in `jest` doesn't ship to customers.
- **Gitleaks** (every PR + push + weekly) — shallow clone on PRs,
  full history on the scheduled weekly run.
- **Trivy image scan** (weekly + manual only) — pulls `ghcr.io/…:latest`
  and produces SARIF per matrix component; kept off the PR fast-lane
  so we don't ping GHCR from every push.

### `codeql.yml` — semantic scan

- CodeQL `security-and-quality` pack over `javascript-typescript`.
- Weekly + on every push/PR to `main`.
- `paths-ignore` for `node_modules`, `dist`, `.next`, `.turbo`,
  Prisma migrations, minified assets, and the shared-types build
  output.

### `load-test.yml` — manual, opinionated

- `workflow_dispatch` only — never scheduled, so a load probe cannot
  fire during an active incident.
- Inputs: `target` (`staging` | `prod`), `scenario` (`smoke` |
  `baseline` | `clock-in-burst` | `dashboard-read` | `timesheet-export`),
  and a `confirm_prod` field that must equal `PROD_YES_I_MEAN_IT`
  to unlock the prod target.
- Reads `API_URL`, `EMPLOYEE_JWT`, `HR_JWT`, `TEST_TENANT_ID` from
  environment-scoped secrets (per `LOAD_TEST_{STAGING,PROD}_*`), so
  URLs never leak into the workflow file.
- Uploads `summary.json` as an artifact (30-day retention) and
  extracts `http_req_duration.p95`, `http_req_failed.rate`, and
  `checks.rate` into the workflow summary.

### `ci.yml` — light tightening

Added a **`pnpm audit --prod --audit-level moderate`** step marked
`continue-on-error: true`. Purpose: nudge maintainers on MODERATE+
without stalling PRs — CRITICAL and HIGH gating lives in
`security.yml`.

### Peripheral

- **`SECURITY.md`** — private disclosure via GitHub Security
  Advisories, 90-day coordinated disclosure window, 2-business-day
  ack + 5-business-day triage SLA, explicit in-/out-of-scope list
  (SSRF, RBAC bypass, MFA bypass, cross-tenant leakage in scope;
  compromised-host DoS out of scope).
- **`.github/ISSUE_TEMPLATE/`** — `bug_report.yml`, `feature_request.yml`,
  `config.yml` that routes P0/P1 to `INCIDENT-RESPONSE.md` and
  security reports to the private advisory form. `blank_issues_enabled: false`.
- **`docs/OPS/CICD.md`** — pipeline map, release cadence (SemVer,
  hotfix flow, pre-release convention), rollback, secrets rotation
  table, red-pipeline runbook, local repro commands.

## Alternatives considered

- **Push images on every merge to `main`.** Rejected — flood of `main-<sha>`
  tags in GHCR without a clear "this is the one we ship" signal.
  We use tags for that.
- **Snyk / Socket / Dependabot Security instead of Trivy.** Rejected
  for now — Trivy is free, integrates with GitHub's Security tab
  natively via SARIF, and gives us both dep-CVE and image-CVE with
  the same tool. Snyk becomes attractive once we cross to Enterprise
  Milestone 3, at which point it can layer on top.
- **Sigstore `cosign sign` instead of GitHub attestations.** Rejected
  — `actions/attest-build-provenance` is a thin wrapper around
  Sigstore that plays nicely with GitHub's own transparency log and
  requires zero secret management. Enterprise cosign flow can be
  added later without breaking this baseline.
- **CircleCI / Buildkite instead of GitHub Actions.** Rejected —
  the repo is already on GitHub; splitting the CI provider would
  fragment the audit trail and add another set of credentials to
  rotate.
- **Multi-arch builds (linux/amd64 + linux/arm64) from day one.**
  Rejected for now — pilot VPS is amd64. Adding arm64 later is a
  one-line change to the matrix.

## Positive consequences

- Every image bytes-in-GHCR is signed with SLSA provenance + carries
  an SBOM. A future regulator asking "prove this container is the
  one you compiled" gets a straight answer via the attestations tab.
- Supply-chain surface has three complementary probes (Trivy,
  `pnpm audit`, gitleaks) plus semantic scanning (CodeQL). No single
  class of vulnerability slips silently.
- Release manager runs **one** command (`git tag v… && git push`) to
  publish; the pipeline handles the rest and produces a
  copy-pasteable deploy prompt.
- Rollback path stays unchanged: `scripts/rollback.sh` reads the
  previous tag from `.last-image-tag` on the VPS.

## Negative consequences

- Weekly scans + on-every-PR Trivy add ~2 minutes to the CI budget.
- Load-test workflow needs environment-scoped secrets that ops must
  create + rotate. Rotation cadence codified in the CICD runbook
  (90 days).
- Prod load-test requires typing a magic string
  (`PROD_YES_I_MEAN_IT`). Marginal friction for a good reason.

## Neutral consequences

- Pre-release tags (`v1.2.0-rc.1`) do **not** get the `latest` docker
  tag. `latest` moves only on stable releases. Ops can still deploy
  RCs by pinning the semver tag directly in `IMAGE_TAG`.

## Rollback plan

CI/CD is code — rollback = revert the offending workflow commit.
Emergency escape hatches per workflow:

- Disable `release.yml` — delete the tag; `latest` retains its previous
  value.
- Disable `security.yml` weekly noise — flip the `schedule:` trigger
  to a comment. Blockers stay on `pull_request` / `push`.
- Disable `load-test.yml` prod path — remove the `LOAD_TEST_PROD_URL`
  secret; the guard step will fail-fast.

## Files touched

**Workflows**

- `.github/workflows/ci.yml` — added advisory `pnpm audit`.
- `.github/workflows/release.yml` (new)
- `.github/workflows/security.yml` (new)
- `.github/workflows/codeql.yml` (new)
- `.github/workflows/load-test.yml` (new)

**Governance**

- `.github/ISSUE_TEMPLATE/bug_report.yml` (new)
- `.github/ISSUE_TEMPLATE/feature_request.yml` (new)
- `.github/ISSUE_TEMPLATE/config.yml` (new)
- `SECURITY.md` (new)

**Docs**

- `docs/OPS/CICD.md` (new)
- `docs/OPS/RUNBOOK-INDEX.md` — link to CICD.md
- `docs/ADR/ADR-0039-cicd-hardening.md` (this file)
- `docs/ROADMAP.md` — OPS-8 marked complete
- `README.md` — feature status + ADR link
