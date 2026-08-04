# Workpulse Roadmap

Living document. Updated setiap kali sebuah fase selesai atau prioritas berubah.

---

## Legenda

- **Prioritas**: `P0` (blocker untuk milestone), `P1` (harus ada sebelum GA), `P2` (nice-to-have / post-GA)
- **Effort**: `XS` (<1 hari), `S` (1–3 hari), `M` (3–7 hari), `L` (1–2 minggu), `XL` (2+ minggu)
- **Status**: ✅ selesai · 🔄 sedang berjalan · ⏸ di-pause · ⏳ belum mulai · ❄ frozen

Estimasi effort mengasumsikan **satu prinsipal engineer** yang sudah familiar dengan codebase, bekerja fokus. Kalikan 2–3× untuk engineer baru.

---

## Snapshot Progres (per 2026-08-04)

| Kategori                                                        |                                                                                                  Progres |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------: |
| Attendance system core (scope awal)                             |                                                                                                 **~95%** |
| Enterprise-grade platform                                       |                                                                                              **~90–94%** |
| Compliance PDP / GDPR (Milestone 1)                             |                                                                        **✅ 100%** — 31a–g tutup lengkap |
| Operational readiness (Beta + M6 closure)                       | **~92%** — OPS-1..OPS-8 shipped; supply-chain (SLSA + SBOM + Trivy + CodeQL + gitleaks) automation aktif |
| Test coverage (1165 unit + 37 E2E)                              |                                                                                                 ✅ Green |
| Documentation (33 ADR + WORKFLOW/ARCHITECTURE + 7 ops runbooks) |                                                                                                  ✅ Sync |

Fase yang sudah dirilis: **1–29 (attendance core + observability + admin), 30a–c (security enterprise), 31a–g (compliance: DSAR, right-to-erasure, retention & consent, ROPA, DPIA, Vendor Register, Breach Ledger), 32a–g (timesheet lengkap), 33a + 33b + 33c (analytics, custom report builder, scheduled email reports), OPS-1..OPS-8 (Beta launch baseline + retention audit + tenant usage + CI/CD hardening — ADR-0036/37/38/39).**

**Beta / Soft Launch (SMB Indonesia) READY + Compliance PDP lengkap** — Milestone 1 (compliance) dan Milestone 6 (operational readiness) sama-sama tutup. Tenant Indonesia siap audit UU 27/2022 PDP end-to-end.

---

## Milestone 1 — Compliance Completion (Q3 2026)

**Tujuan**: menutup deferred item compliance + reporting kritikal sehingga tenant Indonesia + EU siap audit.

| ID      | Nama                                     | Prioritas | Effort | Status | Dependency | Ringkasan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ---------------------------------------- | :-------: | :----: | :----: | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **31e** | DPIA (Data Protection Impact Assessment) |    P1     |   M    |   ✅   | ROPA 31d   | `DpiaAssessment` + `DpiaRiskItem` (FK → `RopaActivity`), state machine `DRAFT→REVIEW→APPROVED→ARCHIVED`, `likelihood × impact` scoring (ENISA 5×5 → LOW/MEDIUM/HIGH/CRITICAL), DB-enforced `residual ≤ inherent` CHECK + partial unique `one_approved_per_activity`, PDF export dengan audit-before-stream SHA-256, `DPIA_*` audit trail atomic dalam tx, `/admin/dpia` FE. ADR-0032.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **31f** | Vendor / Processor Register              |    P2     |   S    |   ✅   | ROPA 31d   | **Shipped**: `VendorProcessor` model per-tenant (identity + data footprint + contract + DPA + review cadence + lifecycle) di `/admin/privacy/vendors` + `RopaActivityVendor` many-to-many join ke `RopaActivity` + `VendorReminderLog` append-only dedup ledger. Forward-only state machine `UNDER_REVIEW → ACTIVE → DEPRECATED → TERMINATED` (`TERMINATED` terminal; `ACTIVE` gated by `dpaSignedAt !== null`). Pure `computeDueReminders(now, …)` decide T-30d review + T-60d contract-expiry reminder (severity `warning → critical` on overdue). `VendorReviewReminderWorker` cron harian 07:00 UTC claim dedup slot sebelum fanout (P2002-safe untuk multi-replica). Dua notification types baru `VENDOR_REVIEW_DUE` + `VENDOR_CONTRACT_EXPIRING` (honour per-user prefs). Setiap mutation menulis `AuditLog VENDOR_PROCESSOR_*` dalam satu transaksi. Kill switch: `VENDOR_REVIEW_REMINDER_WORKER_ENABLED`. UI: list + detail + create form + subnav "Vendor Register". ADR-0038. |
| **31g** | Breach Notification Ledger               |    P1     |   M    |   ✅   | Audit log  | Ledger `/admin/security/breaches` dengan `BreachIncident` + append-only `BreachTimelineEvent` (REVOKE UPDATE, DELETE), forward-only state machine `DETECTED → CONTAINED → NOTIFIED_AUTHORITY → NOTIFIED_SUBJECTS → CLOSED`, deadline math 72h anchor pada `detectedAt` (bucket SAFE/WARNING/CRITICAL/OVERDUE), cron 5-menitan reminder `BREACH_DEADLINE_WARNING` ke DPO/HR/assignee dengan dedup timeline-based, PDF regulator audit-before-stream SHA-256, `BREACH_REMINDER_WORKER_ENABLED` kill switch. ADR-0035. Auto-populate dari anomaly ditunda ke 33d.                                                                                                                                                                                                                                                                                                                                                                                                                          |

**Kriteria selesai Milestone 1**: DPIA siap ekspor PDF regulator-friendly, breach ledger operasional, ROPA + DPIA + Consent + Retention + Vendor Register lengkap dari sisi UU 27/2022 PDP.

**Status**: ✅ **TUTUP** — 31e, 31f, 31g semua shipped. Milestone 1 selesai lengkap.

---

## Milestone 2 — Reporting & Analytics Layer (Q3–Q4 2026)

**Tujuan**: memberikan visibility eksekutif lintas modul supaya HR Director / CEO bisa data-driven.

| ID      | Nama                    | Prioritas | Effort | Status | Ringkasan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | ----------------------- | :-------: | :----: | :----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **33a** | Executive KPI Dashboard |    P1     |   L    |   ✅   | Dashboard di `/admin/analytics` — attendance on-time rate, late/absent count, leave pending & approved days, overtime cost (IDR), headcount active/terminated. Materialised `AnalyticsSnapshot` per `(companyId, date, metricKey)` diisi cron 04:00 UTC + live-today computation. ADR-0031.                                                                                                                                                                                                       |
| **33b** | Custom Report Builder   |    P2     |   XL   |   ✅   | Catalogue-driven declarative builder di `/admin/reports/custom` — 3 dimensi (`DAY`/`DEPARTMENT`/`USER`) × 5 metric (`ATTENDANCE_COUNT`/`ATTENDANCE_LATE_COUNT`/`ATTENDANCE_ON_TIME_RATE`/`LEAVE_DAYS_APPROVED`/`OVERTIME_HOURS`) × 4 window (7/30/90/365). `SavedReport` JSONB + `validateDefinition()` defence-in-depth, parametric `Prisma.sql` fragments (no string concat), CSV/XLSX export audit-before-stream, integrasi ke 33c via `ScheduledReportType.CUSTOM`+`savedReportId`. ADR-0034. |
| **33c** | Scheduled Email Report  |    P1     |   M    |   ✅   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `ReportSchedule` + append-only `ReportDelivery` (REVOKE DELETE), cadence math UTC DAILY/WEEKLY/MONTHLY, cron tiap 15 menit dengan SKIP LOCKED claim + hold-token, `EmailAdapter.attachments` untuk SMTP forwarding, poison-pill isolation, `REPORT_SCHEDULER_ENABLED` kill switch, `HR_MANAGER`/`SUPER_ADMIN` endpoints throttled, FE `/admin/reports/schedules` + delivery log. ADR-0033. |
| **33d** | Anomaly Detection       |    P2     |   L    |   ⏳   | Rule engine: absent streak >3 hari, overtime >`X` jam/minggu, lateness rate >20% → auto-flag ke `/admin/anomalies` + notify HR.                                                                                                                                                                                                                                                                                                                                                                   |

**Kriteria selesai Milestone 2**: HR bisa menjawab "berapa cost lembur bulan lalu per departemen?" dalam <5 detik lewat UI.

**Estimasi total**: **3–4 minggu**

---

## Milestone 3 — Enterprise Integrations (Q4 2026)

**Tujuan**: menghilangkan dealbreaker untuk klien enterprise besar (500+ karyawan) yang punya identity provider dan HRIS existing.

| ID      | Nama                                             | Prioritas | Effort | Status | Ringkasan                                                                                                                                                                                        |
| ------- | ------------------------------------------------ | :-------: | :----: | :----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **34a** | SSO — SAML 2.0                                   |    P0     |   L    |   ⏳   | `/auth/saml/*` — SP-initiated + IdP-initiated flow; per-tenant `SamlConfig` (metadata XML upload, entityId, signing cert); attribute mapping ke `User.email` + role; fallback ke password login. |
| **34b** | SSO — OIDC                                       |    P0     |   M    |   ⏳   | Sama dengan SAML tapi via OpenID Connect (Okta, Azure AD, Google Workspace).                                                                                                                     |
| **34c** | SCIM 2.0 User Provisioning                       |    P1     |   L    |   ⏳   | `/scim/v2/*` endpoint standard — Users + Groups CRUD; token-based auth per tenant; auto-provision `Department` dari SCIM group; deprovision → soft-delete + trigger `DataErasureRequest`.        |
| **34d** | Inbound HRIS Sync (BambooHR / Talenta / Bitwork) |    P1     |   XL   |   ⏳   | Adapter pattern seperti `EmailAdapter`; pull karyawan + org chart secara periodik (config per-tenant); conflict resolution (last-write-wins vs manual review).                                   |

**Kriteria selesai Milestone 3**: Enterprise tenant bisa onboard 1000 karyawan lewat SSO+SCIM tanpa admin bikin akun manual.

**Estimasi total**: **6–8 minggu**

---

## Milestone 4 — Mobile Hardening (Q4 2026 – Q1 2027)

**Tujuan**: mobile experience yang setara desktop, siap dipakai karyawan lapangan (site engineer, driver, security guard).

| ID      | Nama                             | Prioritas | Effort | Status | Ringkasan                                                                                                                                                                              |
| ------- | -------------------------------- | :-------: | :----: | :----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **35a** | Dedicated Mobile API Surface     |    P1     |   M    |   ⏳   | `/mobile/v1/*` dengan payload minimal (drop field yang tidak dipakai di HP), dukung `If-None-Match` untuk caching, batch fetch, dan graceful degradation di jaringan lambat.           |
| **35b** | Offline-first Clock-in Queue     |    P1     |   L    |   ⏳   | Client (React Native / Expo) menyimpan clock-in event lokal saat offline, sync saat online dengan `idempotencyKey` server-side; kompensasi jika event ditolak (mis. di luar geofence). |
| **35c** | Push Notification (FCM + APNs)   |    P0     |   M    |   ⏳   | Adapter pattern (mirror `EmailAdapter`); per-user device token registry; leverage existing `NotificationPreference` untuk opt-in per type.                                             |
| **35d** | Biometric Login                  |    P2     |   S    |   ⏳   | Face ID / fingerprint sebagai step-up setelah password/MFA; secret di secure enclave device, dikombinasikan dengan `RefreshToken`.                                                     |
| **35e** | Native Camera + GPS Optimization |    P2     |   M    |   ⏳   | Compress attachment sebelum upload; batch upload; smart GPS polling (matikan saat outside shift window).                                                                               |

**Kriteria selesai Milestone 4**: Karyawan bisa clock-in di lokasi tanpa sinyal, sync begitu online, tanpa kehilangan data.

**Estimasi total**: **5–7 minggu**

---

## Milestone 5 — Regionalisasi & Localization (Q1 2027)

**Tujuan**: siap dipakai di negara ASEAN lain + memenuhi ekspektasi klien global.

| ID      | Nama                                  | Prioritas | Effort | Status | Ringkasan                                                                                                                               |
| ------- | ------------------------------------- | :-------: | :----: | :----: | --------------------------------------------------------------------------------------------------------------------------------------- |
| **36a** | Multi-language UI (id / en)           |    P1     |   M    |   ⏳   | `next-intl` atau setara; string extraction; QA sweep untuk hardcoded string; toggle bahasa per-user.                                    |
| **36b** | Locale-aware Date / Currency / Number |    P1     |   S    |   ⏳   | Ganti semua `toLocaleString('id-ID')` menjadi user preference; `Intl.NumberFormat` dinamis; timezone display consistent.                |
| **36c** | Regional Public Holiday Sync          |    P2     |   M    |   ⏳   | Adapter untuk fetch dari sumber resmi per negara (Indonesia via kalender pemerintah, Malaysia, Singapore, dst); scheduled sync bulanan. |
| **36d** | Localized Legal Basis (ROPA / DPIA)   |    P2     |   S    |   ⏳   | Blueprint ROPA/DPIA per yurisdiksi (Malaysia PDPA, Singapore PDPA, Philippines DPA), tidak hanya UU 27/2022.                            |

**Estimasi total**: **2–3 minggu**

---

## Milestone 6 — Operational Readiness for GA (paralel dengan M1–M5)

**Tujuan**: production-grade operations sebelum public launch.

| ID        | Nama                             | Prioritas | Effort | Status | Ringkasan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | -------------------------------- | :-------: | :----: | :----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OPS-1** | Production Deployment Playbook   |    P0     |   M    |   ✅   | **Beta baseline shipped (ADR-0036)**: `docker-compose.prod.yml` single-VPS hardened stack (Postgres + api + web + Caddy 2.8 auto TLS + backup sidecar), `scripts/deploy.sh` blue-green playbook (pull → migrate throwaway → recreate api → health check → recreate web + caddy) + `scripts/rollback.sh` image-tag rollback + `scripts/health-check.sh`; `.env.production.example` mendokumentasi semua secret dengan rotation recipe; watchtower opsional via `--profile autoupdate`; K8s migration di-defer sampai tenant > 15. Playbook lengkap: `docs/OPS/DEPLOYMENT.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **OPS-2** | Backup & Restore Drill           |    P0     |   S    |   ✅   | **Beta baseline shipped**: Sidecar container (`docker/backup/`) Alpine + `postgresql16-client` + `rclone` + `age` + `supercronic`; cron 19:15 UTC daily (`BACKUP_CRON`), pipeline in-memory `pg_dump --format=custom` → gzip → age (public-key encryption) → rclone copyto Cloudflare R2 (plaintext never touches disk); 30-day retention auto-prune (`BACKUP_RETENTION_DAYS`); RTO ≤ 2h / RPO ≤ 24h documented; `scripts/backup.sh` (with `TAG=pre-migration` prefix), `scripts/list-backups.sh`, `scripts/restore.sh` (download → decrypt → pg_restore into `${DB}_restored_${timestamp}` + row-count sanity check); quarterly drill playbook + Disaster Recovery flow di `docs/OPS/BACKUP-RESTORE.md`.                                                                                                                                                                                                                                                                                                                                                     |
| **OPS-3** | Load Testing Baseline            |    P1     |   M    |   ✅   | **Beta baseline shipped**: `apps/load-test/` k6 suite dengan 5 skenario — smoke (1 VU × 30s), clock-in burst (250 req/s × 30s peak simulasi jam 08:00), dashboard read (40 VU × 3min HR view), timesheet export (5 VU × 2min payroll async), baseline mixed (30 VU × 5min 70/28/2 read/write/export); SLO thresholds hardcoded ke `options.thresholds` sehingga regresi > 20% fail exit code (CI-ready); target env staging dengan header `X-Load-Test: workpulse-k6` untuk audit; capacity plan XS/S/M/L per tenant size di `docs/OPS/PERFORMANCE.md` + Postgres tuning baseline (shared_buffers 512M, work_mem 8M, max_connections 100). Baseline numbers aktual T.B.M. sampai run pertama pasca-deploy staging.                                                                                                                                                                                                                                                                                                                                            |
| **OPS-4** | SLO / SLA Monitoring             |    P1     |   S    |   ✅   | **Beta baseline shipped**: `GET /api/v1/health/deep` endpoint baru (@Public + @ApiExcludeEndpoint) — parallel probe DB (`SELECT 1`) + storage (`HeadBucketCommand` with 3s AbortController timeout) + worker kill-switch snapshot (8 workers: dataExport / dataErasure / retention / webhook / timesheetScheduler / analyticsSnapshot / reportScheduler / breachReminder); return 503 pada `degraded`/`down` supaya BetterStack alert; 7 unit test untuk `HealthDeepService` (parallelisme, degraded/down transitions, worker flag reading); SLO targets baseline p95 read ≤ 300ms / write ≤ 600ms / export ≤ 5s / uptime ≥ 99.5%; Sentry alert rules + BetterStack setup + heartbeat monitor untuk backup dokumen di `docs/OPS/MONITORING.md`.                                                                                                                                                                                                                                                                                                               |
| **OPS-5** | Incident Response Runbook        |    P1     |   S    |   ✅   | **Beta baseline shipped**: `docs/OPS/INCIDENT-RESPONSE.md` 9 skenario (DB unreachable, S3 unreachable, MFA mass lockout, webhook backlog, breach detected, cron worker stuck, container OOM, TLS rate-limit, full-site down) masing-masing dengan diagnostic commands + kemungkinan penyebab + tindakan bertingkat; `docs/OPS/ON-CALL.md` severity P0/P1/P2/P3 model dengan SLA response 15m/1h/4h/1d + primary+secondary rotasi mingguan + 4 template komunikasi (announce/update/resolve/external) + escalation path + post-mortem template blameless + on-call kit checklist; `docs/OPS/RUNBOOK-INDEX.md` cheat sheet + drill log untuk tracking.                                                                                                                                                                                                                                                                                                                                                                                                          |
| **OPS-6** | Data Retention Enforcement Audit |    P2     |   S    |   ✅   | **Shipped**: `RetentionAuditReport` model (append-only monthly attestation) + cron `RetentionAuditWorker` (day 1 05:30 UTC) yang aggregate `AuditLog` retention actions + probe live tables untuk gap detection. Pure `deriveRetentionAudit()` derive status `SUCCESS/GAP_DETECTED/WORKER_INACTIVE` dengan 4 finding kinds bertingkat severity. UI `/admin/privacy/retention/audit-reports` timeline + detail dengan findings breakdown + policy snapshot. Manual regenerate (SUPER_ADMIN) tidak spam notifikasi. DPO alert via new `RETENTION_AUDIT_GAP_DETECTED` notification (in-app + email). Kill switch: `RETENTION_AUDIT_WORKER_ENABLED`.                                                                                                                                                                                                                                                                                                                                                                                                              |
| **OPS-7** | Cost Instrumentation             |    P2     |   S    |   ✅   | **Shipped**: `TenantUsageSnapshot` model dengan storage (BigInt: export+DSAR), DB row counts per-tabel + total, `notificationsCreated`, `webhookDeliveries`, `activeUsers`, `totalUsers`. Cron `TenantUsageWorker` (day 1 06:00 UTC — 30 menit setelah audit) upsert per tenant. `/admin/usage` — HR_MANAGER tenant sendiri, SUPER_ADMIN cross-tenant table + regenerate. BigInt-safe JSON transport (stringified). Attachment bytes belum di-track — flagged `attachmentBytesTracked=false` sebagai honest gap sampai post-Beta `Attachment` model. Kill switch: `TENANT_USAGE_WORKER_ENABLED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **OPS-8** | CI/CD Hardening                  |    P1     |   S    |   ✅   | **Shipped (ADR-0039)**: Empat workflow baru + `ci.yml` tightening. `release.yml` — trigger tag `v*.*.*`, verify tag ↔ `package.json`, matrix build+push API/Web ke GHCR dengan SLSA provenance attestation + SBOM, smoke Web boot, release summary copy-pasteable. `security.yml` — Trivy filesystem (2-pass: SARIF upload + CRITICAL gate), `pnpm audit --prod --audit-level high`, gitleaks (weekly full history), Trivy image scan mingguan; SARIF ke GitHub Security tab. `codeql.yml` — `security-and-quality` pack untuk JS/TS mingguan + push/PR. `load-test.yml` — manual-only k6 dispatch dengan `PROD_YES_I_MEAN_IT` guard untuk target prod + summary.json artifact + p95/error rate diringkas ke workflow summary. `ci.yml` +advisory `pnpm audit` (moderate). Governance: `SECURITY.md` (90-day disclosure), issue templates (`bug_report.yml`, `feature_request.yml`, `config.yml` route P0 ke INCIDENT-RESPONSE.md). Runbook: `docs/OPS/CICD.md` — pipeline map, release cadence, SemVer, hotfix flow, secrets rotation, red-pipeline runbook. |

**Estimasi total**: **3–4 minggu paralel**

---

## Milestone 7 — Product Extensions (Post-GA / Q2 2027+)

Ide backlog yang menunggu validasi pasar.

| ID      | Nama                                                                  | Prioritas | Effort | Alasan menunggu                                |
| ------- | --------------------------------------------------------------------- | :-------: | :----: | ---------------------------------------------- |
| **37a** | Shift auto-scheduling (optimisasi genetic algorithm)                  |    P2     |   XL   | Perlu data 6 bulan dulu untuk train constraint |
| **37b** | Approval delegation (out-of-office)                                   |    P2     |   M    | Sering diminta tapi bukan dealbreaker          |
| **37c** | Employee self-service portal expansion (payslip, klaim reimbursement) |    P2     |   XL   | Overlap dengan payroll product terpisah        |
| **37d** | AI-powered anomaly explanation                                        |    P2     |   L    | Butuh minimum viable dataset dulu              |
| **37e** | Public API (tenant-facing) + webhook subscription self-serve          |    P2     |   L    | Tunggu 3+ enterprise klien meminta             |
| **37f** | White-label / multi-brand                                             |    P2     |   L    | Menunggu partnership deal                      |

---

## Kondisi Teknis yang Perlu Perhatian Sepanjang Roadmap

- ~~**Prisma schema DPIA yang belum di-migrate**~~ — resolved. Fase 31e shipped dengan migration `20260803240000_dpia`.
- **Beban `AuditLog` tumbuh cepat**: sudah retention automation, tapi query terbaru butuh index review saat DB melewati ~50M rows.
- **Webhook backlog risk**: fixed retry 30s→5m→30m→6h berarti event gagal maksimal 4 attempt lalu FAILED — perlu monitor + auto-alert saat backlog > threshold.
- **`TimesheetExport.payload` disimpan verbatim**: XLSX bisa 100–500 KB per export; retention perlu dipantau (currently tidak di-purge otomatis).
- **Frontend typed-routes**: Next 15 `typedRoutes` memerlukan `as Route` cast di beberapa tempat; kalau upgrade Next 16 nanti, sweep ulang.

---

## Cara Memakai Roadmap Ini

1. **Sebelum mulai fase**: buka file ini, ubah status target dari ⏳ → 🔄, dan buat todo list detail (lihat pola di fase 31d / 32g).
2. **Setelah selesai**: ubah ke ✅, tambah link ke ADR yang bersangkutan, dan update snapshot progres di atas.
3. **Ketika prioritas berubah**: pindahkan row antara milestone dengan menulis alasan singkat di commit message.
4. **Setiap kuartal**: review ulang effort estimate berdasarkan velocity real.

Setiap fase harus punya **ADR** (kalau ada keputusan arsitektural), **WORKFLOW.md entry** (kalau ada business flow baru), dan **README Feature Status row** (semua yang ship). Ini kontrak yang sudah dijalankan di 1–32g dan wajib dipertahankan.
