# Testing Strategy

> Dokumen ini fokus **strategi + arsitektur** test. Untuk **cara menulis /
> debug / maintain** E2E test sehari-hari (selector strategy, flake
> taxonomy, debug playbook, template spec) → baca
> [E2E-GUIDE.md](./E2E-GUIDE.md).

Workpulse memiliki dua lapis test yang saling melengkapi:

| Lapis                                                 | Cakupan                                                       | Kecepatan              | Kapan Dijalankan                         |
| ----------------------------------------------------- | ------------------------------------------------------------- | ---------------------- | ---------------------------------------- |
| **Unit tests** (Jest, mocked Prisma)                  | Domain logic + service methods dengan mocked DB               | Cepat (~2s per suite)  | Pre-commit, `pnpm test`, CI job `verify` |
| **E2E tests** (Playwright, real API + Web + Postgres) | Happy-path integrasi lintas role (Employee → Supervisor → HR) | Lambat (~60–90s total) | `pnpm e2e`, CI job `e2e`                 |

Filosofi: unit test menutup **branch coverage** logika bisnis, E2E menutup
**wire-up correctness** (routing, auth, RBAC, cookie flow, DB constraint).
E2E **tidak** duplicate unit test — sengaja hanya kover happy path critical.

## Struktur

```
apps/e2e/
├── package.json
├── playwright.config.ts          # webServer, browser, reporter
├── global-setup.ts               # prisma migrate reset --force + wait-for-api-stable sebelum semua test (ADR-0015)
├── tests/
│   ├── auth.spec.ts                              # login happy + invalid + protected route
│   ├── leave.spec.ts                             # submit → supervisor → HR (3 role)
│   ├── overtime.spec.ts                          # submit → supervisor (single-level)
│   ├── attendance-supervisor-view.spec.ts        # supervisor team roster + rekap tab
│   ├── attendance-hr-dashboard.spec.ts           # HR company-wide dashboard + RBAC gating
│   ├── attendance-scanner-endpoint.spec.ts       # SUPER_ADMIN scanner trigger + idempotency
│   ├── attendance-manual-absence.spec.ts         # HR mark/delete AbsenceRecord + RBAC + duplicate
│   ├── payroll-cutoff.spec.ts                    # payrollLockedUntil enforcement (attendance: HR blocked, SUPER_ADMIN override)
│   ├── payroll-cutoff-request-types.spec.ts      # cutoff extension untuk leave + overtime (submit/decide/cancel)
│   ├── attendance-correction.spec.ts             # employee-initiated punch correction — happy path, RBAC, cancel, cutoff (ADR-0011)
│   ├── approvals-backlog.spec.ts                 # /admin/approvals/backlog — shape, invariants (total=fresh+stale), RBAC, threshold propagation, integration probe
│   ├── notification-preferences.spec.ts          # /notifications/preferences — defaults matrix, upsert, mandatory bypass, unknown enum, effective-gate probe (ADR-0012)
│   ├── audit-log.spec.ts                         # /admin/audit-log — shape + actor join, filter propagation, keyset pagination invariants, RBAC (ADR-0013)
│   ├── audit-log-export.spec.ts                  # /admin/audit-log/export — NDJSON headers, wire contract, filter propagation, RBAC, empty-result (ADR-0013 follow-up)
│   ├── notifications-archive.spec.ts             # /notifications/archive — shape, unread filter, keyset pagination invariants, mark-all-read integration
│   ├── change-password.spec.ts                   # /auth/change-password + MustChangePasswordGuard — temp-login 403 enforcement, happy-path rotation, admin re-arm, INVALID_CREDENTIALS, UI redirect from /login, UI success toast (ADR-0014)
│   ├── fixtures/
│   │   └── users.ts              # kredensial seed users (employee/supervisor/hr/admin)
│   └── helpers/
│       ├── login.ts              # loginAs(page, 'employee' | 'supervisor' | 'hr' | 'admin')
│       ├── api.ts                # authenticateApi(key) → bearer-armed APIRequestContext
│       ├── cleanup.ts            # cancelOvertimeFor(workDate), cancelLeaveOverlapping(from,to) — pre-flight hygiene helpers (ADR-0015)
│       └── dates.ts              # date utilities untuk workDate, startDate, dsb.
```

## Attendance Modules E2E — cakupan

| Spec                                   | Fokus                                                                                                                             | Assertion utama                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attendance-supervisor-view.spec.ts`   | Supervisor `/attendance/team` — roster join + tab switching                                                                       | Employee (direct report) visible di "Hari ini" & "Rekap"; role gating link                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `attendance-hr-dashboard.spec.ts`      | `/attendance/dashboard` (HR + Super Admin)                                                                                        | Stat cards + per-department table; date-picker → network refetch dengan `date=` query; supervisor tidak dapat akses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `attendance-scanner-endpoint.spec.ts`  | `POST /attendance/scanner/run` + `POST /attendance/scanner/reset-cursor` (SUPER_ADMIN) — level API                                | Run: response shape `{ scannedCompanies, totalMarked, durationMs }`; idempotent run kedua `totalMarked=0`; RBAC 403/401 untuk HR/supervisor/unauth. Reset-cursor (Fase 21): `after: null` + `rescanTriggered:false` default; dengan `triggerRescan:true` menambahkan `rescanResult` bershape `{ companyId, scannedDates, marked, durationMs, skipped:{...} }`; RBAC 403/401 identik dengan endpoint run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `attendance-manual-absence.spec.ts`    | `POST /attendance/absence` + `DELETE /attendance/absence/:id` (HR + SUPER_ADMIN) — level API                                      | Full lifecycle: create → status ABSENT + `absenceRecordId` + source=MANUAL_HR di roster → delete → status kembali NOT_CLOCKED_IN; second-mark 409, future date/malformed id 400, non-HR 403, unauth 401                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `payroll-cutoff.spec.ts`               | `Company.payrollLockedUntil` enforcement (attendance)                                                                             | HR set/clear cutoff via PATCH `/admin/company`; HR mark/delete inside frozen period → 409 `PAYROLL_LOCKED` (dengan `cutoffDate`); SUPER_ADMIN bypass sukses; tanggal setelah cutoff tetap writable oleh HR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `payroll-cutoff-request-types.spec.ts` | Cutoff extension untuk leave + overtime (ADR-0010 follow-up)                                                                      | Leave: HR submit / decide dalam periode beku → 409 `PAYROLL_LOCKED`, employee cancel juga tertolak, SUPER_ADMIN dapat REJECT lewat decide-endpoint. Overtime: submit / decide / cancel dalam periode beku → 409, SUPER_ADMIN dapat decide. Tanggal setelah cutoff tetap flow normal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `attendance-correction.spec.ts`        | Attendance Correction end-to-end (ADR-0011)                                                                                       | Happy path: employee submits → supervisor approves → `AttendanceRecord` muncul di history employee. RBAC: EMPLOYEE dapat 403 di endpoint approvals; EMPLOYEE tidak dapat approve request-nya sendiri. Cancel: owner-only (403 untuk supervisor foreign-cancel). Cutoff: HR submit/decide dalam periode beku → 409 `PAYROLL_LOCKED`; SUPER_ADMIN dapat decide (REJECT) request yang masih PENDING di dalam cutoff.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `approvals-backlog.spec.ts`            | Cross-module PENDING visibility (`GET /admin/approvals/backlog`) — WORKFLOW §1.10                                                 | Shape: response memuat 3 modul (leave/overtime/correction) dengan `total/fresh/stale/buckets/oldest[]`. Invariant: `total === fresh + stale` untuk setiap modul. RBAC: HR + SUPER_ADMIN 200, SUPERVISOR + EMPLOYEE 403. Threshold param: `?thresholdDays=7` echoed di response. Integration probe: submit correction baru → correction backlog count naik 1 (kalau 201) / tetap (kalau 409 duplicate).                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `notification-preferences.spec.ts`     | Preferensi notifikasi per-user (ADR-0012)                                                                                         | GET returns full 15-row matrix dengan defaults-on + flag `mandatory` untuk `PASSWORD_RESET`. PUT upsert one type mengembalikan fresh list + independent GET konsisten. PUT untuk `PASSWORD_RESET` silently di-drop (mandatory tetap ON). Empty updates = 200 no-op. Unknown enum value = 400. Unauthenticated GET/PUT = 401. Effective-gate probe: supervisor opt-out `OVERTIME_SUBMITTED` in-app → employee submit overtime → supervisor's in-app count untuk tipe tersebut TIDAK bertambah.                                                                                                                                                                                                                                                                                                                                                                             |
| `audit-log.spec.ts`                    | Audit log viewer HR/compliance (`GET /admin/audit-log` — ADR-0013)                                                                | Shape + newest-first invariant: setiap row memuat `id/action/entityType/entityId/actorId/createdAt`, `actorName`+`actorEmail` string-or-null (soft-deleted actor tetap listable), `createdAt` monotonic desc. Filter propagation: `?action=COMPANY_CONFIG_UPDATED` → semua row.action match; `?entityType=Company` → semua row.entityType match. Keyset pagination: page 2 (via `nextCursor` dari page 1) tidak beririsan dengan page 1 dan setiap row page 2 strictly older than anchor page 1 (atau same-ts + lower id). Cursor invalid = 400. RBAC: HR + SUPER_ADMIN 200; SUPERVISOR + EMPLOYEE 403; unauthenticated 401.                                                                                                                                                                                                                                              |
| `audit-log-export.spec.ts`             | Audit log NDJSON streaming export (`GET /admin/audit-log/export` — Fase 26 / ADR-0013 follow-up)                                  | Headers: `Content-Type=application/x-ndjson`, `Content-Disposition=attachment` dengan `.ndjson`, `Cache-Control=no-store`, `X-Content-Type-Options=nosniff`. Wire contract: body parseable line-by-line via NDJSON parser, setiap baris berisi object dengan `id/action/entityType/entityId/actorId/createdAt`. Newest-first invariant carry-over dari JSON list. Filter propagation: `?entityType=Company&action=COMPANY_CONFIG_UPDATED` → semua row match. Empty case: filter mustahil = valid `application/x-ndjson` dengan zero rows. RBAC: HR + SUPER_ADMIN 200; SUPERVISOR + EMPLOYEE 403; unauthenticated 401.                                                                                                                                                                                                                                                     |
| `notifications-archive.spec.ts`        | Notification archive (`GET /notifications/archive` + `POST /notifications/read-all` — Fase 25)                                    | Shape: setiap row `id/type/title/body/createdAt` string, `readAt` string-or-null. Newest-first invariant di semua page. Filter: `unreadOnly=true` memastikan setiap row `readAt` null. Keyset: page-2 keys off page-1 nextCursor, no id overlap, strictly older-or-same-ts+lower-id. Cursor invalid = 400. Mark-all-read integration: setelah `POST /read-all`, `unreadOnly=true` archive = empty + `unread-count` = 0 + follow-up `read-all` idempotent (marked=0). Auth: GET/POST unauthenticated = 401.                                                                                                                                                                                                                                                                                                                                                                |
| `change-password.spec.ts`              | Temp-password enforcement + self-service rotation (`POST /auth/change-password` + `MustChangePasswordGuard` — Fase 27 / ADR-0014) | Setup: setiap test provisions throwaway user via `POST /admin/users` (temporaryPassword direveal), cleanup via soft-delete. **API-level.** Temp-login: `LoginResponse.user.mustChangePassword=true`; `/auth/me` (allowlisted) 200; `/leave/mine` 403 dengan `code: 'PASSWORD_CHANGE_REQUIRED'`. Happy path: change-password → all refresh tokens revoked (`/auth/refresh` 401), old password 401, new password 200 dengan flag=false, protected endpoint 200. Wrong current password → 401 `INVALID_CREDENTIALS`. Admin re-arm: user pick-own → login flag=false → admin reset → login pakai temp baru → flag=true lagi. **UI-level.** Login dengan temp password → redirect ke `/change-password` + banner "password sementara" visible. UI change-password sukses → redirect ke `/login?changed=1` + toast "berhasil diubah"; login pakai password baru sukses via API. |

Prinsip pembagian:

- **UI specs** menegakkan wiring FE ↔ BE ↔ RBAC gating dan payload rendering.
- **API-level specs** (`attendance-scanner-endpoint.spec.ts`,
  `attendance-manual-absence.spec.ts` via helper `authenticateApi`)
  menegakkan RBAC + response shape untuk endpoint admin yang butuh
  matriks skenario penuh — menghindari inflating UI specs dengan
  XHR-only concern.
- Assertion **hindari nilai konkret** seperti `totalMarked=3` karena
  auto-absent classification bergantung pada wall-clock time (grace
  window) — angka konkret ini sudah di-cover unit test isolasi.

## Menjalankan E2E Lokal

**Prasyarat:**

- Postgres running (`docker compose up -d postgres` atau native).
- Sudah `pnpm install`.
- Browser Chromium untuk Playwright — install sekali: `pnpm e2e:install`.

**Cara termudah — Playwright yang orchestrate semua:**

```bash
pnpm e2e
```

Playwright akan:

1. Jalankan `prisma migrate deploy + prisma db seed` (via `global-setup.ts`).
2. Spawn `pnpm --filter @workpulse/api dev` di background.
3. Spawn `pnpm --filter @workpulse/web dev` di background.
4. Tunggu `/api/v1/health` dan `localhost:3000` sampai OK.
5. Run seluruh spec Chromium.
6. Tear-down semua server.

**Cara alternatif — kalau `pnpm dev` sudah jalan di terminal lain:**

Playwright default `reuseExistingServer: true` di local, jadi cukup:

```bash
# Terminal 1
pnpm dev

# Terminal 2
pnpm e2e
```

**UI mode (debugging):**

```bash
pnpm e2e:ui         # Playwright test UI (time-travel debugging)
pnpm e2e:headed     # Non-headless run — lihat browser langsung
pnpm e2e:report     # Buka laporan HTML dari run terakhir
```

## Environment Variables

| Var                            | Default                 | Kapan diubah                                                                                                                                                                         |
| ------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `E2E_API_URL`                  | `http://localhost:4000` | API di port non-standar                                                                                                                                                              |
| `E2E_WEB_URL`                  | `http://localhost:3000` | Web di port non-standar                                                                                                                                                              |
| `WORKPULSE_E2E_SKIP_MIGRATE=1` | _(unset)_               | Skip `migrate deploy + seed` — iterasi cepat saat DB known-good. Jangan pakai kalau baru pull update yang mengubah seed users (mis. penambahan `admin@acme.test` untuk SUPER_ADMIN). |
| `CI=1`                         | _(unset)_               | Aktifkan retries=2, `start:prod` (bukan `dev`), reporter GitHub                                                                                                                      |

## Multi-Role Coordination Pattern

Test seperti `leave.spec.ts` menjalankan **satu skenario ordered** yang lewat
tiga role. Kami tidak memecahnya menjadi 3 test terpisah karena assertion-nya
stateful (Supervisor perlu melihat sesuatu yang Employee baru saja submit).

Setiap role pakai `browser.newContext()` sendiri — ini equivalent dengan
"buka Incognito baru untuk tiap role" secara Playwright, sehingga cookie
session tidak bocor antar-role. Jangan pakai `page.goBack()` untuk switch
role — selalu buat context baru.

Setiap run E2E menggunakan **`runId` unik** (embedded ke `reason` string)
sehingga re-run terhadap DB yang sama tidak collide dengan pengajuan yang
belum di-clean dari run sebelumnya.

## Global Setup Semantics

`global-setup.ts` menggunakan `prisma migrate deploy` + `prisma db seed`
bukan `migrate reset` karena:

- **CI:** container Postgres fresh setiap run → deploy + seed = equivalent full reset, tanpa risiko `--force` reset ke DB yang salah.
- **Lokal:** dev tidak ingin datanya hilang tiap `pnpm e2e`. Seed di-tulis
  full-idempotent (`upsert` semua) sehingga menerima state existing +
  memastikan seeded row tetap ada.

Untuk hard reset lokal, jalankan manual: `pnpm db:migrate:reset` — bukan tanggung jawab E2E.

## Menambah Test Baru

1. **Identifikasi user flow yang critical.** Kandidat: sesuatu yang kalau
   rusak akan blocking penggunaan dan tidak ter-cover unit test (mis.
   attendance clock-in dengan geofence, admin CRUD, report download).
2. **Buat spec baru di `tests/`** — satu file per feature besar.
3. **Reuse `loginAs` + fixtures** — jangan duplikasi credential string.
4. **Gunakan role selector, bukan CSS.** Prefer `getByRole('button', { name: 'Setujui' })` daripada `page.locator('.btn-primary')` — copy Indonesia bisa berubah tapi role stabil.
5. **Assert on effects, bukan implementation.** Assert "row hilang dari
   approval queue" (menunjukkan state berubah) daripada "class CSS
   berubah".
6. **Timeout 10s** cukup untuk kebanyakan operasi network dari CI. Naikkan
   ke 30s hanya untuk operasi berat (report download, presigned upload).

## Anti-Pattern yang Harus Dihindari

- ❌ **Assert on Indonesian copy langsung.** Copy bisa berubah — pakai role,
  ID, atau data-testid.
- ❌ **`page.waitForTimeout(1000)`.** Selalu race-y — gunakan
  `waitForURL` / `expect(...).toBeVisible()` / `waitForResponse` sebagai
  gantinya.
- ❌ **Manual `document.cookie` manipulation.** Session flow adalah bagian
  yang di-test — biarkan real login berjalan.
- ❌ **Shared runId antar test.** Setiap test harus punya scope datanya
  sendiri, tidak bergantung pada test sebelumnya.

## CI Integration

Job `e2e` di `.github/workflows/ci.yml`:

- Service container: `postgres:15-alpine` dengan healthcheck.
- Build `apps/api` dan `apps/web` production (sekali) — Playwright config
  dalam mode CI pakai `start:prod` / `next start` supaya boot time-nya
  konsisten dengan prod.
- Upload `playwright-report/` sebagai artifact setiap run (7 hari retensi).
- Upload `test-results/` (trace + video + screenshot) hanya kalau ada
  failure — traces dari retry berguna untuk debug flake tanpa harus repro
  lokal.

Job berjalan **paralel** dengan job `verify` dan `docker` — total wall
time PR ≈ waktu job terlama (biasanya `e2e` ~ 8 menit).

## Trade-Off dari Ruang Lingkup MVP

Yang **belum** di-kover E2E (deliberately):

- **Attendance clock-in.** Butuh mock geolocation Playwright + presisi tolerance geofence. High-value tapi butuh setup extra — kandidat kuat untuk fase berikutnya.
- **Admin CRUD (users, geofence, shift, holiday).** Butuh clean-up antar test yang lebih ketat karena UNIQUE constraint. Bisa di-kover bertahap.
- **Report download.** Butuh handling binary response Playwright — pattern-nya jelas, cuma belum di-prioritas MVP.
- **Attachment upload.** Butuh MinIO/S3 mock atau real MinIO service container. Overkill untuk MVP.

Roadmap: tambahkan satu spec baru per fase feature berikutnya sesuai
convention di file ini.
