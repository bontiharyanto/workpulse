# Security Policy

Workpulse is an enterprise-grade attendance and workforce-management
platform that processes personal data under UU 27/2022 Pelindungan Data
Pribadi (Indonesia) and, for EU-tenant deployments, GDPR. We take
security reports seriously and want to make it easy for researchers,
customers, and internal contributors to reach us privately.

## Supported versions

We provide security fixes for:

| Version       |      Supported       |
| ------------- | :------------------: |
| `v1.x` (Beta) |          ✅          |
| `v0.x`        | ❌ upgrade to `v1.x` |

The Beta / Soft Launch (SMB Indonesia) is tracked in
[docs/ROADMAP.md](./docs/ROADMAP.md).

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security reports.
Instead:

1. Open a **[GitHub Security Advisory](https://github.com/haryanto/workpulse/security/advisories/new)**
   from the repository's `Security` tab. This creates a private
   collaboration space with the maintainers.
2. If you cannot reach the advisory form, email the maintainer team
   with the subject prefix `[workpulse-security]`. Contact addresses
   are listed in the repository's private ops runbook.

Please include:

- A concise description of the issue and its impact.
- Steps to reproduce (ideally against a fresh clone).
- Any proof-of-concept payload, redacted to avoid affecting real users.
- Your suggested severity (CVSS v3.1 vector optional but appreciated).

## Our response commitments

- **Acknowledgement**: within **2 business days** (Asia/Jakarta hours).
- **Triage & severity assignment**: within **5 business days**.
- **Fix ETA**: shared during triage, tied to severity per
  [docs/OPS/INCIDENT-RESPONSE.md](./docs/OPS/INCIDENT-RESPONSE.md).
  Critical issues target a hotfix release inside 72 hours.

We will keep you informed as the fix progresses and credit you (with
your permission) in the release notes and the `CHANGELOG` once the
patch is public.

## Scope

**In scope**

- Vulnerabilities in this repository (API, Web, shared packages,
  Dockerfiles, deploy scripts).
- Issues in the default configuration described by `.env.production.example`.
- Data leakage across tenants, RBAC bypass, MFA bypass, session
  hijacking, SSRF, SQLi, RCE, XSS, deserialization flaws, or any
  cryptographic misuse.
- Supply-chain concerns in `package.json` / `pnpm-lock.yaml`.

**Out of scope**

- Vulnerabilities that require a compromised host / infrastructure the
  customer controls (e.g. a rooted VPS, a stolen JWT signing key from
  the customer's own `.env`).
- Denial-of-service traffic patterns already documented in
  `docs/OPS/PERFORMANCE.md` — rate-limits, throttles, and Postgres
  connection caps are known limits that ops handles operationally.
- Missing security-hardening headers on non-production hosts (`localhost`,
  ephemeral preview environments).
- Physical / social engineering attacks against the maintainer team.

## Coordinated disclosure

We follow a **90-day disclosure window** by default, negotiable if:

- A patch requires customer-side action beyond a version bump.
- The issue chain includes a third-party upstream that is still fixing.
- Regulator notification obligations apply — see the
  `BreachIncident` workflow (Fase 31g / ADR-0035).

Please do not publish details before the coordinated disclosure date.
