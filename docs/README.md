# Workpulse Documentation Portal

Selamat datang di dokumentasi Workpulse — sistem absensi enterprise multi-tenant
untuk pasar HRTech Indonesia. Halaman ini adalah **peta navigasi**: mulai dari
sini, telusuri ke dokumen sesuai peran Anda.

- **Kode & test:** English.
- **Prosa untuk pengguna akhir (Admin, User Manual, UAT):** Bahasa Indonesia.
- **Prosa untuk engineer & operator (Architecture, OPS, ADR):** campuran —
  headline & command English, penjelasan kadang Indonesia. Ikuti pola dokumen
  yang sudah ada saat menulis dokumen baru.

---

## 1. Peta dokumen berdasarkan peran

Pilih peran Anda dan ikuti kolom “mulai dari”.

| Peran                                          | Mulai dari                                             | Kemudian                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Karyawan / Supervisor** (pengguna aplikasi)  | [USER-MANUAL.md](./USER-MANUAL.md)                     | —                                                                                                                                                                    |
| **HR Manager / Super Admin** (operator tenant) | [ADMIN-GUIDE.md](./ADMIN-GUIDE.md)                     | [WORKFLOW.md](./WORKFLOW.md) untuk semua alur bisnis; [OPS/](./OPS/) untuk operasional produksi                                                                      |
| **Tester / QA** (E2E manual + UAT)             | [UAT-E2E.md](./UAT-E2E.md)                             | [DEMO-USERS.md](./DEMO-USERS.md) untuk kredensial demo; [../apps/e2e/tests/](../apps/e2e/tests/) untuk suite otomatis                                                |
| **Engineer baru** (onboarding)                 | [DEVELOPMENT.md](./DEVELOPMENT.md)                     | [ARCHITECTURE.md](./ARCHITECTURE.md) → [WORKFLOW.md](./WORKFLOW.md) → [TESTING.md](./TESTING.md)                                                                     |
| **Backend / Full-stack engineer**              | [ARCHITECTURE.md](./ARCHITECTURE.md)                   | [API.md](./API.md) · [MIGRATIONS.md](./MIGRATIONS.md) · [ADR/](./ADR/) sesuai fitur yang disentuh                                                                    |
| **Release manager / DevOps**                   | [OPS/CICD.md](./OPS/CICD.md)                           | [OPS/DEPLOYMENT.md](./OPS/DEPLOYMENT.md) · [OPS/RUNBOOK-INDEX.md](./OPS/RUNBOOK-INDEX.md)                                                                            |
| **On-call engineer** (incident)                | [OPS/INCIDENT-RESPONSE.md](./OPS/INCIDENT-RESPONSE.md) | [OPS/ON-CALL.md](./OPS/ON-CALL.md) · [OPS/BACKUP-RESTORE.md](./OPS/BACKUP-RESTORE.md) · [OPS/MONITORING.md](./OPS/MONITORING.md)                                     |
| **Security officer / DPO**                     | [../SECURITY.md](../SECURITY.md)                       | [ADR-0017 (MFA)](./ADR/ADR-0017-mfa-totp.md) · [ADR-0020 (DSAR)](./ADR/ADR-0020-data-export-dsar.md) · [ADR-0022 (Consent)](./ADR/ADR-0022-retention-and-consent.md) |

---

## 2. Struktur repositori dokumen

```
workpulse/
├── README.md                      # Overview + quick start + fase-per-fase changelog
├── CONTRIBUTING.md                # Workflow branch, commit convention, coding standard
├── SECURITY.md                    # Kebijakan disclosure + threat model summary
├── docs/
│   ├── README.md                  # ← Anda di sini
│   ├── ARCHITECTURE.md            # Clean Architecture + DDD + concurrency rules
│   ├── WORKFLOW.md                # Alur bisnis: attendance, leave, overtime, timesheet
│   ├── API.md                     # REST API surface + error codes + auth
│   ├── DEVELOPMENT.md             # Onboarding developer 30 menit
│   ├── ADMIN-GUIDE.md             # Panduan HR / Super Admin (Indonesia)
│   ├── USER-MANUAL.md             # Panduan karyawan / supervisor (Indonesia)
│   ├── UAT-E2E.md                 # Skenario UAT end-to-end (Indonesia)
│   ├── DEMO-USERS.md              # Kredensial demo + coverage per user
│   ├── GLOSSARY.md                # Kamus istilah domain
│   ├── MIGRATIONS.md              # Prisma migration workflow
│   ├── TESTING.md                 # Strategi unit + E2E
│   ├── ROADMAP.md                 # Fase yang sudah rilis + backlog
│   ├── ADR/                       # 40+ Architecture Decision Records
│   │   ├── ADR-0001-monorepo-and-stack.md
│   │   ├── ADR-0002-auth-strategy.md
│   │   ├── … (setiap keputusan arsitektural signifikan)
│   └── OPS/                       # Runbook operasional produksi
│       ├── RUNBOOK-INDEX.md       # Master index runbook
│       ├── DEPLOYMENT.md          # Playbook deploy VPS single-node
│       ├── CICD.md                # Pipeline map + release cadence
│       ├── BACKUP-RESTORE.md      # Backup strategy + drill procedure
│       ├── MONITORING.md          # Health check + Sentry + log
│       ├── PERFORMANCE.md         # p95 targets + tuning knobs
│       ├── ON-CALL.md             # Rotasi + escalation policy
│       └── INCIDENT-RESPONSE.md   # Skenario incident → tindakan
```

---

## 3. Konsep inti dalam 60 detik

1. **Multi-tenant.** Setiap tabel domain punya kolom `companyId`. Setiap
   query wajib memfilter di kolom tersebut — dijaga oleh Prisma extension
   & test.
2. **Server-authoritative.** Geofence, leave balance, overtime rate,
   RBAC — semua diputuskan di NestJS service, **bukan** di Next.js.
   Frontend hanya rendering.
3. **Audit-first.** Perubahan sensitif menulis ke `AuditLog` dalam
   transaksi yang sama; `UPDATE`/`DELETE` di-`REVOKE` di level DB role.
4. **Clean Architecture.** `domain/` bebas framework, `service/` orkestrasi
   & transaksi, `controller/` tipis. Dependency selalu ke arah domain.
5. **UU PDP-ready.** DSAR (export), right-to-erasure, ROPA, DPIA, breach
   notification ledger — semua sudah ada di produksi. Lihat
   [ADR-0020](./ADR/ADR-0020-data-export-dsar.md) → [ADR-0035](./ADR/ADR-0035-breach-notification-ledger.md).

Detail: [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 4. Direktori ADR (Architecture Decision Records)

Setiap keputusan arsitektural signifikan didokumentasikan sebagai ADR. Sortir
kronologis di [ADR/](./ADR/). Highlight — baca ini saat mengubah fitur terkait:

| Domain                                    | ADR                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Stack + monorepo                          | [ADR-0001](./ADR/ADR-0001-monorepo-and-stack.md)                                                                   |
| Auth (JWT)                                | [ADR-0002](./ADR/ADR-0002-auth-strategy.md)                                                                        |
| Docker + CI                               | [ADR-0003](./ADR/ADR-0003-docker-and-ci.md)                                                                        |
| Attachment (S3/MinIO)                     | [ADR-0004](./ADR/ADR-0004-attachment-strategy.md)                                                                  |
| Overtime scheduler                        | [ADR-0005](./ADR/ADR-0005-overtime-completion-scheduler.md)                                                        |
| Notifications                             | [ADR-0006](./ADR/ADR-0006-notification-strategy.md) · [ADR-0012](./ADR/ADR-0012-notification-preferences.md)       |
| Lateness detection                        | [ADR-0007](./ADR/ADR-0007-attendance-lateness-detection.md)                                                        |
| Auto-absent                               | [ADR-0008](./ADR/ADR-0008-auto-absent-and-hr-dashboard.md) · [ADR-0009](./ADR/ADR-0009-manual-absence-override.md) |
| Payroll cutoff                            | [ADR-0010](./ADR/ADR-0010-payroll-cutoff.md)                                                                       |
| Attendance correction                     | [ADR-0011](./ADR/ADR-0011-attendance-correction.md)                                                                |
| Audit log viewer                          | [ADR-0013](./ADR/ADR-0013-audit-log-viewer.md)                                                                     |
| Must-change-password                      | [ADR-0014](./ADR/ADR-0014-must-change-password.md)                                                                 |
| E2E hygiene                               | [ADR-0015](./ADR/ADR-0015-e2e-test-hygiene.md)                                                                     |
| Multi-tenant admin                        | [ADR-0016](./ADR/ADR-0016-multi-tenant-admin-and-observability.md)                                                 |
| MFA (TOTP)                                | [ADR-0017](./ADR/ADR-0017-mfa-totp.md)                                                                             |
| Session management                        | [ADR-0018](./ADR/ADR-0018-session-management.md)                                                                   |
| Email + security headers                  | [ADR-0019](./ADR/ADR-0019-email-transport-and-security-headers.md)                                                 |
| DSAR (UU PDP fase 31a)                    | [ADR-0020](./ADR/ADR-0020-data-export-dsar.md)                                                                     |
| Right-to-erasure (31b)                    | [ADR-0021](./ADR/ADR-0021-right-to-erasure.md)                                                                     |
| Retention + consent (31c)                 | [ADR-0022](./ADR/ADR-0022-retention-and-consent.md)                                                                |
| Timesheet foundation → export → scheduler | [ADR-0023](./ADR/ADR-0023-timesheet-foundation.md) → [ADR-0029](./ADR/ADR-0029-timesheet-reopen.md)                |
| Outbound webhooks                         | [ADR-0027](./ADR/ADR-0027-outbound-webhooks.md)                                                                    |
| ROPA (record of processing)               | [ADR-0030](./ADR/ADR-0030-ropa-registry.md)                                                                        |
| Analytics dashboard                       | [ADR-0031](./ADR/ADR-0031-analytics-executive-dashboard.md)                                                        |
| DPIA registry                             | [ADR-0032](./ADR/ADR-0032-dpia-registry.md)                                                                        |
| Custom report builder                     | [ADR-0034](./ADR/ADR-0034-custom-report-builder.md)                                                                |
| Breach notification ledger                | [ADR-0035](./ADR/ADR-0035-breach-notification-ledger.md)                                                           |
| Beta launch ops baseline                  | [ADR-0036](./ADR/ADR-0036-beta-launch-ops-baseline.md)                                                             |
| Retention audit + usage                   | [ADR-0037](./ADR/ADR-0037-retention-audit-and-tenant-usage.md)                                                     |
| Vendor / processor register               | [ADR-0038](./ADR/ADR-0038-vendor-processor-register.md)                                                            |
| CI/CD hardening                           | [ADR-0039](./ADR/ADR-0039-cicd-hardening.md)                                                                       |
| Geofence map picker + Tier-2 signals      | [ADR-0040](./ADR/ADR-0040-geofence-map-picker-and-tier2-signals.md)                                                |

Konvensi ADR: template Michael Nygard (Context → Decision → Consequences).
Buat ADR baru saat menambah fitur cross-module atau mengubah invariant.

---

## 5. Ke mana bila…?

### "Saya mau menambah endpoint API baru."

1. Baca [ARCHITECTURE.md §3](./ARCHITECTURE.md) (layering) + [§4](./ARCHITECTURE.md) (cross-cutting).
2. Baca [API.md](./API.md) untuk konvensi versioning, error shape, pagination.
3. Ikuti pola directory `apps/api/src/<feature>/` di [ARCHITECTURE.md](./ARCHITECTURE.md).
4. DTO + Zod schema wajib. Update [`packages/shared-types/`](../packages/shared-types/).
5. Tulis unit test service, tambahkan happy path ke `apps/e2e/tests/` bila lintas role.
6. Update [WORKFLOW.md](./WORKFLOW.md) bila menambah alur bisnis baru.

### "Saya mau ubah schema database."

Lihat [MIGRATIONS.md](./MIGRATIONS.md). TL;DR: `pnpm --filter @workpulse/api prisma:migrate` → commit `schema.prisma` + folder migration bersama.

### "Saya mau menambah role atau permission."

- Backend: [ADR-0002](./ADR/ADR-0002-auth-strategy.md) + `src/common/decorators/roles.decorator.ts`.
- Frontend: `apps/web/components/features/auth/require-role.tsx`.
- Test: tambahkan skenario di `apps/e2e/tests/*-rbac.spec.ts`.

### "Aplikasi mati / lambat di produksi."

[OPS/INCIDENT-RESPONSE.md](./OPS/INCIDENT-RESPONSE.md) → [OPS/MONITORING.md](./OPS/MONITORING.md) → [OPS/PERFORMANCE.md](./OPS/PERFORMANCE.md).

### "Saya mau tahu password demo untuk demo ke stakeholder."

[DEMO-USERS.md](./DEMO-USERS.md).

### "Saya mau menjalankan UAT end-to-end sebelum go-live."

[UAT-E2E.md](./UAT-E2E.md). Tiap skenario dilengkapi role, pre-condition, langkah, dan expected result.

### "Saya lupa istilah 'geofence' vs 'shift' vs 'assignment'."

[GLOSSARY.md](./GLOSSARY.md).

---

## 6. Cara menulis / mengubah dokumen

1. **Update dokumen yang paling spesifik dulu** — ADR bila keputusan
   arsitektural, WORKFLOW bila alur bisnis berubah, ADMIN-GUIDE / USER-MANUAL
   bila UI berubah.
2. **Update ringkasan yang lebih tinggi** (dokumen ini, README.md) hanya bila
   tautan / peta berubah — bukan tiap perubahan konten.
3. **Diagram** — pakai fenced code block ASCII sederhana kalau bisa;
   Mermaid diperbolehkan bila GitHub bisa merender.
4. **File path** — selalu gunakan backtick + relative path dari root repo,
   mis. `apps/api/src/attendance/attendance.service.ts`.
5. **Bahasa** — ikuti pola dokumen yang sudah ada. Bila ragu, konsultasi
   [`.cursor/rules/10-response-and-language.mdc`](../.cursor/rules/10-response-and-language.mdc).
6. **PR checklist** ada di [`.github/pull_request_template.md`](../.github/pull_request_template.md).
   Butir "Docs updated (`WORKFLOW.md` / `ARCHITECTURE.md`) when behavior changes"
   wajib dicentang bila perilaku berubah.

---

## 7. Kontak & tanggung jawab

| Area                       | Owner (per `.github/CODEOWNERS`) |
| -------------------------- | -------------------------------- |
| Dokumentasi, ADR, workflow | `@haryanto`                      |
| Backend `apps/api/`        | `@haryanto`                      |
| Frontend `apps/web/`       | `@haryanto`                      |
| CI/CD `.github/`           | `@haryanto`                      |
| Docker, infra              | `@haryanto`                      |

Untuk laporan security, ikuti [`../SECURITY.md`](../SECURITY.md) — **jangan**
buka issue publik.

---

_Terakhir diperbarui: 2026-08-07. Bila ada tautan mati atau bagian yang
terasa usang, kirim PR — dokumentasi adalah kode._
