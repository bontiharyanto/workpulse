# CI/CD Runbook — Workpulse

Living document for how code becomes a running production container.
Read this alongside [DEPLOYMENT.md](./DEPLOYMENT.md) (target infra) and
[INCIDENT-RESPONSE.md](./INCIDENT-RESPONSE.md) (when the pipeline fails
during an incident).

- Audience: engineers, release managers, on-call.
- Owner: `@haryanto` (per `.github/CODEOWNERS`).

---

## 1. Pipeline map

Five workflows live under `.github/workflows/`:

| File            | Trigger                                    | Purpose                                                                                         |
| --------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `ci.yml`        | PR + push to `main`                        | Lint, typecheck, unit tests, E2E (Playwright + real Postgres), Docker build smoke.              |
| `security.yml`  | PR + push + weekly Sun 22:00 UTC + manual  | Trivy filesystem + image, `pnpm audit --prod`, gitleaks (weekly = full history).                |
| `codeql.yml`    | PR + push to `main` + weekly Sun 20:00 UTC | CodeQL semantic scan (`security-and-quality` pack) for `javascript-typescript`.                 |
| `release.yml`   | Push of tag `v*.*.*` (+ manual)            | Verify tag ↔ package.json, build+push API/Web to GHCR, SLSA provenance, smoke, release summary. |
| `load-test.yml` | Manual dispatch only                       | k6 run against staging/prod, uploads `summary.json`, prints SLO deltas to the job summary.      |

Ancillary files:

- `.github/CODEOWNERS` — every PR needs at least one review from the
  listed owner(s); rules are path-specific.
- `.github/dependabot.yml` — weekly npm / GitHub-Actions / Docker
  updates, grouped by dev-deps / `@types/*` / `@nestjs/*` / Prisma /
  Next.
- `.github/ISSUE_TEMPLATE/*` — structured intake for bugs + features;
  security reports route to `SECURITY.md`.
- `.github/pull_request_template.md` — mandatory checklist mirrored on
  the repo standards rules (`60-repo-and-docs-standards.mdc`).

## 2. Release cadence

We follow **SemVer** with tag prefix `v`:

- `MAJOR` — breaking API contract change or breaking Prisma migration
  (`DROP COLUMN` etc.). Requires migration ADR under `docs/ADR/`.
- `MINOR` — additive features, additive migrations, new endpoints.
- `PATCH` — bug fixes, security patches, doc-only changes.
- Pre-release tags allowed: `v1.4.0-rc.1`, `v1.4.0-beta.2`.
  Pre-release tags **do not** get the `latest` docker tag.

Typical cadence for the pilot:

- **Beta / Soft Launch**: one `MINOR` per two weeks + `PATCH` as
  needed. Hotfix path documented below.
- **GA**: one `MINOR` per month, `PATCH` weekly if needed.

## 3. Cutting a release

```bash
# 0. On main, pull latest.
git checkout main && git pull --ff-only

# 1. Bump package.json (root). The release workflow will fail-fast
#    if the tag doesn't match this value.
pnpm version 1.2.3 --no-git-tag-version -w   # updates root package.json only
git commit -am "chore(release): v1.2.3"
git push

# 2. Tag and push. The release workflow will fire on push.
git tag v1.2.3
git push origin v1.2.3
```

The workflow will:

1. `verify-tag` — cross-check tag ↔ `package.json`.
2. `publish` (matrix `api` + `web` in parallel) — buildx to
   `linux/amd64`, push to `ghcr.io/haryanto/workpulse/{api,web}` with
   tags `v1.2.3`, `1.2.3`, and `latest` (for non-prerelease tags),
   plus SLSA provenance attestation.
3. `smoke` — pulls the freshly-pushed images and boots the Web one to
   confirm the health endpoint returns 200. API smoke stays as manifest
   inspection because it runs `prisma migrate deploy` at boot.
4. `summary` — prints copy-pasteable deploy commands to the workflow
   summary.

The **release manager** then hops onto the target VPS and runs:

```bash
IMAGE_TAG=1.2.3 bash scripts/deploy.sh
bash scripts/health-check.sh   # or /admin monitoring endpoint
```

## 4. Hotfix flow

For a P0 / P1 that needs a targeted fix without shipping unrelated
main-branch work:

```bash
# Branch off the current production tag, not main.
git checkout -b hotfix/1.2.3-1 v1.2.3
# … apply minimal patch, add a test that would have caught it …
pnpm test && pnpm typecheck
git commit -am "fix(security): patch <CVE / defect> (P0)"

# Bump patch and tag.
pnpm version 1.2.4 --no-git-tag-version -w
git commit -am "chore(release): v1.2.4"
git tag v1.2.4 && git push origin hotfix/1.2.3-1 v1.2.4

# Open a PR back to main so the fix does NOT diverge.
```

Deploy the hotfix immediately via `scripts/deploy.sh`, then chase the
PR merge afterwards. **Never** leave `main` behind a hotfix tag.

## 5. Rollback

If `bash scripts/health-check.sh` returns non-zero after a deploy:

```bash
bash scripts/rollback.sh          # reads .last-image-tag on the VPS
bash scripts/health-check.sh      # sanity re-check
```

Rollback does **not** revert migrations. Every migration must ship in
the `expand → contract` pattern so an older image tag stays compatible
with the new schema for at least one release cycle.

## 6. Secrets management

Secrets used by workflows:

| Secret                           | Owner  | Consumer                        |
| -------------------------------- | ------ | ------------------------------- |
| `GITHUB_TOKEN` (built-in)        | GitHub | GHCR push, CodeQL, SARIF upload |
| `LOAD_TEST_STAGING_URL`          | Ops    | `load-test.yml` (staging)       |
| `LOAD_TEST_STAGING_EMPLOYEE_JWT` | Ops    | `load-test.yml` (staging)       |
| `LOAD_TEST_STAGING_HR_JWT`       | Ops    | `load-test.yml` (staging)       |
| `LOAD_TEST_STAGING_TENANT_ID`    | Ops    | `load-test.yml` (staging)       |
| `LOAD_TEST_PROD_URL`             | Ops    | `load-test.yml` (prod)          |
| `LOAD_TEST_PROD_EMPLOYEE_JWT`    | Ops    | `load-test.yml` (prod)          |
| `LOAD_TEST_PROD_HR_JWT`          | Ops    | `load-test.yml` (prod)          |
| `LOAD_TEST_PROD_TENANT_ID`       | Ops    | `load-test.yml` (prod)          |

Rotation:

- Load-test JWTs rotate every **90 days** (calendar reminder on the
  ops team). Use synthetic pilot-tenant accounts, never real HR
  accounts.
- Rotation procedure: mint fresh JWTs on the target env, update the
  GitHub Actions secret, retire the old JWT via `/admin/sessions`
  revoke.

## 7. What to do when the pipeline is red

`ci.yml` red on main:

1. Check the failing job. Lint / typecheck / test errors are almost
   always a `main` regression from a fast-forwarded merge — fix on a
   branch, PR, done.
2. If a flaky E2E is suspected, click "Re-run failed jobs" **once**.
   If it fails twice, treat it as a real defect (open an issue with
   the Playwright trace artifact).

`security.yml` red:

- `trivy-fs` CRITICAL — a CVE landed in the dep graph. Check the
  Security tab for the advisory + upgrade path. Bump the dep on a
  fast-track PR.
- `pnpm-audit` HIGH — same procedure.
- `gitleaks` any severity — treat as an incident: rotate the leaked
  credential first, then remove the commit + force-push a scrubbed
  history if it is fresh.

`release.yml` red:

- `verify-tag` — tag and `package.json` disagree. Fix locally, re-tag.
- `publish` — usually GHCR auth. Confirm `GITHUB_TOKEN` still has
  `packages: write`.
- `smoke` — the image boots but fails health. Inspect the workflow's
  `docker logs smoke` output; do **not** ship this tag to prod.

`load-test.yml` red:

- Check the archived `summary.json` artifact. SLO thresholds live in
  `apps/load-test/lib/config.js` and in the individual scenario
  files. A > 20% regression against the baseline in
  [PERFORMANCE.md](./PERFORMANCE.md) is a release-blocker.

## 8. Local reproduction of a CI failure

```bash
# The same commands CI runs, in the same order:
pnpm install --frozen-lockfile
pnpm --filter @workpulse/shared-types build
pnpm --filter @workpulse/api exec prisma generate
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build

# Docker smoke build (no push):
docker build -f apps/api/Dockerfile -t workpulse/api:local .
docker build -f apps/web/Dockerfile -t workpulse/web:local .

# Security probes:
docker run --rm -v "$(pwd):/repo" aquasec/trivy fs --severity CRITICAL /repo
pnpm audit --prod --audit-level high
```

## 9. Change log

Every notable pipeline change goes here, newest first, so on-call has
a single place to look when behaviour surprises them.

| Date       | Change                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| 2026-08-04 | OPS-8 initial baseline: release / security / codeql / load-test workflows, SECURITY.md, issue templates, ADR-0039. |
