# API Reference

REST API surface untuk Workpulse. Dokumen ini bersifat **konseptual + peta
tinggi**: menjelaskan konvensi (auth, versioning, error, pagination) dan
mendaftar endpoint per modul. Untuk kontrak byte-per-byte, kode di
`apps/api/src/<feature>/*.controller.ts` adalah source of truth (setiap DTO
divalidasi dengan `class-validator`).

- **Base URL (dev):** `http://localhost:4000/api/v1`
- **Base URL (production):** `https://<tenant-host>/api/v1`
- **Global prefix:** `/api` (dari `app.setGlobalPrefix('api')` di `main.ts`)
- **Versioning:** URI-based, default `v1` — semua route `/api/v1/…`

---

## 1. Konvensi umum

### 1.1 Autentikasi

- **Bearer JWT** di header `Authorization: Bearer <access_token>`.
- Access token TTL default 15 menit (`JWT_EXPIRES_IN`).
- Refresh token TTL 7 hari (`JWT_REFRESH_EXPIRES_IN`), disimpan sebagai
  `HttpOnly` cookie `wp_rt`.
- Login menghasilkan **dua** token — refresh cookie di-set otomatis;
  access token dikembalikan di body untuk browser dan client eksternal.
- Refresh flow: `POST /auth/refresh` (butuh cookie `wp_rt`); rotasi refresh
  token dilakukan setiap kali sukses.

Sebagian besar route juga menjalankan **tiga guard rantai** (di luar route
yang di-mark `@Public()` / `@AllowPendingConsent()`):

1. `JwtAuthGuard` — validasi JWT.
2. `MustChangePasswordGuard` — bila `user.mustChangePassword=true`, hanya
   `/auth/change-password` yang boleh dipakai (returns `403 PASSWORD_CHANGE_REQUIRED`).
3. `ConsentAcceptedGuard` — bila privacy policy versi terbaru belum di-accept,
   hanya `/me/consent` yang boleh (returns `403 CONSENT_REQUIRED`).

MFA — bila user sudah enroll TOTP atau `SecurityPolicy.mfaEnforceHighPrivileged=true`
untuk role HR_MANAGER / SUPER_ADMIN, login memaksa langkah `/auth/mfa/verify`
sebelum menerbitkan access token. Detail: [ADR-0017](./ADR/ADR-0017-mfa-totp.md).

### 1.2 RBAC — decorator role

Setiap route menandai role yang diizinkan lewat `@Roles('...')`. Empat role
kanonik:

| Role          | Cakupan data           | Tipikal endpoint yang bisa diakses                                 |
| ------------- | ---------------------- | ------------------------------------------------------------------ |
| `EMPLOYEE`    | Data diri sendiri      | `/me/*`, `/attendance/clock-in`, `/leave` (own), `/overtime` (own) |
| `SUPERVISOR`  | Timnya sendiri         | + `/attendance/team/*`, `/leave/:id/approve` (level 1)             |
| `HR_MANAGER`  | Seluruh company        | + `/admin/*` company-scope, `/leave/:id/approve` (level 2)         |
| `SUPER_ADMIN` | Cross-tenant (audited) | + `/admin/companies/*`, override cutoff, scanner run               |

Endpoint tanpa `@Roles(...)` sesudah `JwtAuthGuard` = **semua role yang login**
boleh akses (dengan filter tenant di service layer).

### 1.3 Pagination — keyset

Endpoint yang mengembalikan koleksi besar (audit log, notifikasi archive,
timesheet history) memakai **keyset pagination**:

```
GET /admin/audit-log?limit=50&cursor=<opaque-cursor>
```

Response:

```json
{
  "items": [/* ... */],
  "nextCursor": "eyJpZCI6IjAxSjJYIiwidHMiOjE3MTIzMzUwMDB9",
  "hasMore": true
}
```

- `limit` bounded (biasanya 1–100, default 50).
- `cursor` opaque — client cukup meneruskan apa adanya untuk halaman berikut.
- Halaman terakhir: `hasMore=false`, `nextCursor=null`.

### 1.4 Timestamp

- **Wire format:** ISO-8601 UTC (`2026-08-07T14:30:00.000Z`).
- **Timezone lokal:** dihitung di server memakai `APP_TIMEZONE=Asia/Jakarta`
  (WIB, UTC+7). Frontend tampilkan sesuai timezone user.

### 1.5 Format response

Sukses — payload langsung (bukan `{ data: … }` wrapper) kecuali koleksi paginated.

Error — [error envelope terstandar](#3-error-shape).

### 1.6 Idempotency

- `POST /attendance/clock-in` idempoten dalam window 60 detik — dua panggilan
  identik dari user yang sama menghasilkan record yang sama, bukan duplikat.
- Webhook receiver (`POST /admin/webhooks/deliveries/:id/retry`) idempoten via
  header `Idempotency-Key`.
- Scanner (`POST /attendance/scanner/run`) menggunakan cursor sehingga
  aman dijalankan berulang.

### 1.7 Rate limiting

- Global `ThrottlerGuard` di `main.ts`: 30 req/menit per IP default.
- Route sensitif override:
  - `POST /auth/login` — 5/menit per IP.
  - `POST /auth/mfa/verify` — 5/menit per IP.
  - `POST /me/data-export` — 1/hari per user (env `DATA_EXPORT_COOLDOWN_HOURS`).
- Return `429 Too Many Requests` bila terlampaui.

---

## 2. Peta endpoint per modul

Semua route berada di bawah `/api/v1`. Kolom **role** menampilkan role
minimum; kombinasi baca `apps/api/src/<feature>/*.controller.ts`.

### 2.1 Auth & session

| Endpoint                            | Method | Role                             | Purpose                                                       |
| ----------------------------------- | ------ | -------------------------------- | ------------------------------------------------------------- |
| `/auth/login`                       | POST   | Public                           | Login email + password; return access token + refresh cookie. |
| `/auth/logout`                      | POST   | Any auth                         | Revoke current session; clear refresh cookie.                 |
| `/auth/refresh`                     | POST   | Cookie                           | Rotate refresh token; return new access token.                |
| `/auth/me`                          | GET    | Any auth (allow-pending-consent) | Return current user profile + role + must-change flags.       |
| `/auth/change-password`             | POST   | Any auth                         | Ganti password; clears `mustChangePassword`.                  |
| `/auth/mfa/enroll`                  | POST   | Any auth                         | Start TOTP enrollment; return QR + secret.                    |
| `/auth/mfa/verify-enrollment`       | POST   | Any auth                         | Confirm enrollment dengan first OTP; issue backup codes.      |
| `/auth/mfa/verify`                  | POST   | Login-in-progress                | Verify OTP saat login flow.                                   |
| `/auth/mfa/backup-codes`            | GET    | Any auth                         | Show remaining count + last-regenerated timestamp.            |
| `/auth/mfa/regenerate-backup-codes` | POST   | Any auth                         | Re-issue set baru; invalidasi yang lama.                      |
| `/auth/mfa/disable`                 | DELETE | Any auth                         | Unenroll TOTP untuk user ini.                                 |
| `/auth/sessions`                    | GET    | Any auth                         | Daftar session aktif (device, IP, last-seen).                 |
| `/auth/sessions/:id`                | DELETE | Any auth                         | Revoke satu session.                                          |
| `/auth/sessions/others`             | DELETE | Any auth                         | Revoke semua kecuali yang sekarang.                           |

Detail: [ADR-0002](./ADR/ADR-0002-auth-strategy.md), [ADR-0014](./ADR/ADR-0014-must-change-password.md), [ADR-0017](./ADR/ADR-0017-mfa-totp.md), [ADR-0018](./ADR/ADR-0018-session-management.md).

### 2.2 Consent (UU PDP)

| Endpoint                  | Method | Role                             | Purpose                                            |
| ------------------------- | ------ | -------------------------------- | -------------------------------------------------- |
| `/me/consent/current`     | GET    | Any auth (allow-pending-consent) | Return active policy + apakah user sudah accept.   |
| `/me/consent/accept`      | POST   | Any auth (allow-pending-consent) | Accept versi aktif; unblock semua route.           |
| `/admin/privacy/policies` | GET    | HR_MANAGER, SUPER_ADMIN          | List versioned policies.                           |
| `/admin/privacy/policies` | POST   | SUPER_ADMIN                      | Publish versi baru (auto-invalidasi consent lama). |

Detail: [ADR-0022](./ADR/ADR-0022-retention-and-consent.md).

### 2.3 Attendance

| Endpoint                             | Method | Role                                | Purpose                                                                        |
| ------------------------------------ | ------ | ----------------------------------- | ------------------------------------------------------------------------------ |
| `/attendance/clock-in`               | POST   | EMPLOYEE, SUPERVISOR, HR_MANAGER    | Clock in — server hitung geofence, lateness. Body: `{lat,lng,accuracy,ssid?}`. |
| `/attendance/clock-out`              | POST   | EMPLOYEE, SUPERVISOR, HR_MANAGER    | Clock out — server hitung durasi, early-leave.                                 |
| `/attendance/me/today`               | GET    | EMPLOYEE, SUPERVISOR, HR_MANAGER    | Record + events hari ini untuk user.                                           |
| `/attendance/me/history`             | GET    | EMPLOYEE, SUPERVISOR, HR_MANAGER    | History paginated (query: from, to, cursor).                                   |
| `/attendance/me/summary`             | GET    | EMPLOYEE, SUPERVISOR, HR_MANAGER    | Rekap bulan ini (present, absent, late, leave).                                |
| `/attendance/team/today`             | GET    | SUPERVISOR, HR_MANAGER, SUPER_ADMIN | Roster tim hari ini.                                                           |
| `/attendance/team/summary`           | GET    | SUPERVISOR, HR_MANAGER, SUPER_ADMIN | Rekap tim (period query).                                                      |
| `/attendance/dashboard`              | GET    | HR_MANAGER, SUPER_ADMIN             | Dashboard company-wide (KPI, breakdown).                                       |
| `/attendance/absence`                | POST   | HR_MANAGER, SUPER_ADMIN             | Manual mark absence (dengan reason).                                           |
| `/attendance/absence/:id`            | DELETE | HR_MANAGER, SUPER_ADMIN             | Undo manual absence.                                                           |
| `/attendance/scanner/run`            | POST   | SUPER_ADMIN                         | Trigger auto-absent scanner (idempotent).                                      |
| `/attendance/scanner/reset-cursor`   | POST   | SUPER_ADMIN                         | Reset scanner cursor (recovery only).                                          |
| `/attendance/corrections`            | POST   | EMPLOYEE, SUPERVISOR                | Ajukan koreksi punch (missed clock-in/out).                                    |
| `/attendance/corrections/:id/decide` | POST   | SUPERVISOR, HR_MANAGER              | Approve / reject koreksi.                                                      |

Detail: [ADR-0007](./ADR/ADR-0007-attendance-lateness-detection.md), [ADR-0008](./ADR/ADR-0008-auto-absent-and-hr-dashboard.md), [ADR-0009](./ADR/ADR-0009-manual-absence-override.md), [ADR-0011](./ADR/ADR-0011-attendance-correction.md), [ADR-0040](./ADR/ADR-0040-geofence-map-picker-and-tier2-signals.md).

**Kontrak clock-in (contoh):**

```http
POST /api/v1/attendance/clock-in
Authorization: Bearer <token>
Content-Type: application/json

{
  "latitude": -6.2088,
  "longitude": 106.8456,
  "accuracy": 12,
  "timestamp": "2026-08-07T08:15:00.000Z",
  "ssid": "OFFICE-WIFI"          // opsional; dipakai fallback Tier-2
}
```

Response 201:

```json
{
  "id": "01J2XABCD…",
  "clockInAt": "2026-08-07T08:15:00.000Z",
  "isLate": false,
  "lateMinutes": 0,
  "geofence": { "ok": true, "distanceMeters": 18 }
}
```

Error umum: `403 OUTSIDE_GEOFENCE`, `403 ACCURACY_TOO_LOW`, `409 ALREADY_CLOCKED_IN`, `403 NO_SHIFT_ASSIGNED`.

### 2.4 Leave

| Endpoint             | Method                | Role                            | Purpose                                              |
| -------------------- | --------------------- | ------------------------------- | ---------------------------------------------------- |
| `/leave/types`       | GET                   | Any auth                        | Daftar jenis cuti yang berlaku di company.           |
| `/leave/balances`    | GET                   | Any auth                        | Saldo untuk user login.                              |
| `/leave`             | POST                  | EMPLOYEE, SUPERVISOR            | Ajukan cuti; server validasi + reserve balance.      |
| `/leave/me`          | GET                   | Any auth                        | History cuti user (paginated).                       |
| `/leave/team`        | GET                   | SUPERVISOR, HR_MANAGER          | Cuti tim (pending + recent).                         |
| `/leave/:id`         | GET                   | Owner / SUPERVISOR / HR_MANAGER | Detail.                                              |
| `/leave/:id/approve` | POST                  | SUPERVISOR, HR_MANAGER          | Approve level sesuai role — dalam transaksi + audit. |
| `/leave/:id/reject`  | POST                  | SUPERVISOR, HR_MANAGER          | Reject; balance dikembalikan.                        |
| `/leave/:id/cancel`  | POST                  | Owner (bila belum approved)     | Cancel oleh pemohon.                                 |
| `/admin/leave-types` | GET/POST/PATCH/DELETE | HR_MANAGER, SUPER_ADMIN         | CRUD leave type + accrual/carry-over config.         |

Detail: [WORKFLOW.md — Leave](./WORKFLOW.md), [ADR-0010](./ADR/ADR-0010-payroll-cutoff.md).

**Invariant** (server-enforced):

- Balance dicek + dikurangi dalam **satu transaksi** dengan `SELECT ... FOR UPDATE` (Prisma `$queryRaw` + optimistic `version`).
- Reject / cancel dikembalikan dalam transaksi yang sama dengan mutasi status.
- Payroll cutoff — request yang overlap `payrollLockedUntil` return `403 PAYROLL_LOCKED`.

### 2.5 Overtime

| Endpoint                       | Method | Role                            | Purpose                                       |
| ------------------------------ | ------ | ------------------------------- | --------------------------------------------- |
| `/overtime`                    | POST   | EMPLOYEE, SUPERVISOR            | Ajukan overtime pre-approval.                 |
| `/overtime/me`                 | GET    | Any auth                        | History user.                                 |
| `/overtime/team`               | GET    | SUPERVISOR, HR_MANAGER          | Backlog + history tim.                        |
| `/overtime/:id`                | GET    | Owner / SUPERVISOR / HR_MANAGER | Detail (dengan rate + total dihitung server). |
| `/overtime/:id/approve`        | POST   | SUPERVISOR, HR_MANAGER          | Approve; state → APPROVED.                    |
| `/overtime/:id/reject`         | POST   | SUPERVISOR, HR_MANAGER          | Reject.                                       |
| `/overtime/:id/cancel`         | POST   | Owner                           | Cancel bila belum decided.                    |
| `/admin/overtime`              | GET    | HR_MANAGER, SUPER_ADMIN         | Overview company-wide.                        |
| `/admin/overtime/complete-run` | POST   | SUPER_ADMIN                     | Trigger scheduler completion (idempotent).    |

Detail: [ADR-0005](./ADR/ADR-0005-overtime-completion-scheduler.md).

### 2.6 Timesheet

| Endpoint                             | Method    | Role                    | Purpose                                                      |
| ------------------------------------ | --------- | ----------------------- | ------------------------------------------------------------ |
| `/me/timesheet/period/current`       | GET       | Any auth                | Period aktif + entries user.                                 |
| `/me/timesheet/entries`              | PATCH     | EMPLOYEE                | Update draft entries.                                        |
| `/me/timesheet/submit`               | POST      | EMPLOYEE                | Submit draft; state → SUBMITTED.                             |
| `/me/timesheet/withdraw`             | POST      | EMPLOYEE                | Tarik kembali (bila belum approved).                         |
| `/admin/timesheet`                   | GET       | HR_MANAGER, SUPER_ADMIN | List timesheet lintas user.                                  |
| `/admin/timesheet/:id/approve`       | POST      | HR_MANAGER              | Approve final.                                               |
| `/admin/timesheet/:id/reopen`        | POST      | HR_MANAGER              | Reopen approved (audited).                                   |
| `/admin/timesheet/exports`           | POST      | HR_MANAGER              | Buat export (CSV / XLSX / PDF) — return signed download URL. |
| `/admin/timesheet/exports/:id/share` | POST      | HR_MANAGER              | Buat shareable link bertanda HMAC.                           |
| `/public/timesheet-exports/:id`      | GET       | Signed URL              | Download via HMAC link (TTL bounded).                        |
| `/admin/timesheet/config`            | GET/PATCH | HR_MANAGER, SUPER_ADMIN | Konfigurasi period, cutoff, reminder.                        |

Detail: [ADR-0023](./ADR/ADR-0023-timesheet-foundation.md) → [ADR-0029](./ADR/ADR-0029-timesheet-reopen.md).

### 2.7 Notifikasi

| Endpoint                     | Method | Role     | Purpose                                         |
| ---------------------------- | ------ | -------- | ----------------------------------------------- |
| `/notifications/inbox`       | GET    | Any auth | Inbox unread + recent read (paginated).         |
| `/notifications/archive`     | GET    | Any auth | Semua notifikasi (paginated, filter unread).    |
| `/notifications/:id/read`    | POST   | Any auth | Mark satu read.                                 |
| `/notifications/read-all`    | POST   | Any auth | Mark semua read.                                |
| `/notifications/preferences` | GET    | Any auth | Preference per event + channel.                 |
| `/notifications/preferences` | PATCH  | Any auth | Upsert; mandatory channel tidak bisa dimatikan. |

Detail: [ADR-0006](./ADR/ADR-0006-notification-strategy.md), [ADR-0012](./ADR/ADR-0012-notification-preferences.md).

### 2.8 Admin — company, department, user, shift, geofence, holiday

| Endpoint                   | Method                | Role                    | Purpose                                          |
| -------------------------- | --------------------- | ----------------------- | ------------------------------------------------ |
| `/admin/company`           | GET/PATCH             | HR_MANAGER, SUPER_ADMIN | Profil company aktif.                            |
| `/admin/companies`         | GET/POST/PATCH        | SUPER_ADMIN             | Cross-tenant management (audited).               |
| `/admin/departments`       | GET/POST/PATCH/DELETE | HR_MANAGER              | CRUD department.                                 |
| `/admin/users`             | GET/POST/PATCH/DELETE | HR_MANAGER              | CRUD user + assign role / department.            |
| `/admin/shifts`            | GET/POST/PATCH/DELETE | HR_MANAGER              | Shift definition (static / flexible / rotating). |
| `/admin/shifts/:id/assign` | POST                  | HR_MANAGER              | Assign shift ke user dengan effective date.      |
| `/admin/geofences`         | GET/POST/PATCH/DELETE | HR_MANAGER              | Geofence CRUD (map picker + templates).          |
| `/admin/holidays`          | GET/POST/PATCH/DELETE | HR_MANAGER              | Kalender libur per company.                      |

### 2.9 Admin — governance & compliance (UU PDP)

| Endpoint                          | Method                | Role                    | Purpose                                               |
| --------------------------------- | --------------------- | ----------------------- | ----------------------------------------------------- |
| `/admin/audit-log`                | GET                   | HR_MANAGER, SUPER_ADMIN | Query audit log (paginated + filter).                 |
| `/admin/audit-log/export`         | GET                   | HR_MANAGER, SUPER_ADMIN | Export NDJSON stream.                                 |
| `/admin/approvals/backlog`        | GET                   | HR_MANAGER, SUPER_ADMIN | Backlog fresh + stale (leave / OT / correction / TS). |
| `/admin/security/policy`          | GET/PATCH             | HR_MANAGER, SUPER_ADMIN | Security policy per-tenant (MFA enforce).             |
| `/admin/security/breaches`        | GET/POST/PATCH        | HR_MANAGER, SUPER_ADMIN | Breach notification ledger.                           |
| `/admin/ropa`                     | GET/POST/PATCH/DELETE | HR_MANAGER, SUPER_ADMIN | Record of processing.                                 |
| `/admin/dpia`                     | GET/POST/PATCH/DELETE | HR_MANAGER, SUPER_ADMIN | DPIA registry.                                        |
| `/admin/privacy/vendors`          | GET/POST/PATCH/DELETE | HR_MANAGER, SUPER_ADMIN | Vendor / processor register.                          |
| `/admin/privacy/retention`        | GET/PATCH             | HR_MANAGER, SUPER_ADMIN | Retention config per tenant.                          |
| `/admin/data-erasure`             | GET                   | HR_MANAGER, SUPER_ADMIN | Antrean erasure request.                              |
| `/admin/data-erasure/:id/approve` | POST                  | HR_MANAGER, SUPER_ADMIN | Approve; grace period berjalan.                       |
| `/admin/analytics/executive`      | GET                   | HR_MANAGER, SUPER_ADMIN | Dashboard KPI executive (from snapshots).             |
| `/admin/reports`                  | GET                   | HR_MANAGER, SUPER_ADMIN | List report + schedule.                               |
| `/admin/reports/custom`           | GET/POST/PATCH/DELETE | HR_MANAGER, SUPER_ADMIN | Custom report definition.                             |
| `/admin/webhooks`                 | GET/POST/PATCH/DELETE | HR_MANAGER, SUPER_ADMIN | Outbound webhook subscribers.                         |
| `/admin/webhooks/deliveries`      | GET                   | HR_MANAGER, SUPER_ADMIN | Delivery log + retry queue.                           |
| `/admin/usage`                    | GET                   | HR_MANAGER, SUPER_ADMIN | Monthly tenant usage snapshot.                        |

### 2.10 Me — DSAR + erasure (UU PDP)

| Endpoint                       | Method | Role     | Purpose                                                   |
| ------------------------------ | ------ | -------- | --------------------------------------------------------- |
| `/me/data-export`              | POST   | Any auth | Ajukan DSAR — cooldown 24h default.                       |
| `/me/data-export`              | GET    | Any auth | Riwayat + status.                                         |
| `/me/data-export/:id/download` | GET    | Owner    | Signed download link (bounded TTL).                       |
| `/me/data-erasure`             | POST   | Any auth | Ajukan penghapusan data — masuk queue APPROVED_SCHEDULED. |
| `/me/data-erasure`             | GET    | Any auth | Status permintaan.                                        |

Detail: [ADR-0020](./ADR/ADR-0020-data-export-dsar.md), [ADR-0021](./ADR/ADR-0021-right-to-erasure.md).

### 2.11 Attachment (S3-presigned)

| Endpoint                   | Method | Role               | Purpose                                                      |
| -------------------------- | ------ | ------------------ | ------------------------------------------------------------ |
| `/attachments/presign-put` | POST   | Any auth           | Return `{uploadUrl, key}` — client PUT langsung ke S3/MinIO. |
| `/attachments/presign-get` | POST   | Any auth           | Return signed GET URL untuk download.                        |
| `/attachments/:id`         | DELETE | Owner / HR_MANAGER | Soft-delete + S3 delete async.                               |

Detail: [ADR-0004](./ADR/ADR-0004-attachment-strategy.md).

### 2.12 Health

| Endpoint        | Method | Role   | Purpose                                             |
| --------------- | ------ | ------ | --------------------------------------------------- |
| `/health`       | GET    | Public | Liveness — return `{status:"ok", version, uptime}`. |
| `/health/ready` | GET    | Public | Readiness — cek DB + storage + worker.              |

Response 200 = healthy; 503 = degraded (dipakai load balancer).

---

## 3. Error shape

Semua error mengikuti envelope terstandar (dari `HttpExceptionFilter`):

```json
{
  "statusCode": 403,
  "code": "OUTSIDE_GEOFENCE",
  "message": "Anda berada di luar area kerja yang diperbolehkan.",
  "path": "/api/v1/attendance/clock-in",
  "timestamp": "2026-08-07T08:15:00.000Z",
  "details": null
}
```

- **`statusCode`** — HTTP status (200-599).
- **`code`** — konstanta stabil, machine-readable. Client di-encourage
  branching pada `code`, bukan `message`.
- **`message`** — human-readable, boleh diubah tanpa breaking change.
- **`details`** — nullable; berisi tambahan struktural (misal `{fields: […]}`
  saat `VALIDATION_FAILED`).

### 3.1 Katalog error code umum

**Auth (401 / 403)**

| Code                       | Kapan                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| `INVALID_CREDENTIALS`      | Email / password salah.                                                           |
| `ACCOUNT_LOCKED`           | Terlalu banyak login gagal.                                                       |
| `PASSWORD_CHANGE_REQUIRED` | User punya `mustChangePassword=true`; hanya `/auth/change-password` bisa dipakai. |
| `CONSENT_REQUIRED`         | Privacy policy versi baru belum di-accept.                                        |
| `MFA_REQUIRED`             | Login butuh langkah MFA berikutnya.                                               |
| `MFA_INVALID_OTP`          | OTP salah / expired.                                                              |
| `MFA_LOCKED`               | Terlalu banyak OTP salah.                                                         |
| `INSUFFICIENT_ROLE`        | Role user tidak masuk `@Roles(...)`.                                              |
| `SESSION_REVOKED`          | Refresh token / session sudah di-revoke.                                          |

**Attendance (403 / 409)**

| Code                   | Kapan                                                       |
| ---------------------- | ----------------------------------------------------------- |
| `OUTSIDE_GEOFENCE`     | Koordinat > radius geofence shift.                          |
| `ACCURACY_TOO_LOW`     | GPS accuracy > `maxAccuracyMeters`.                         |
| `SSID_NOT_ALLOWED`     | Wi-Fi SSID tidak di-`allowedSsids`.                         |
| `NO_SHIFT_ASSIGNED`    | User tidak punya `UserShiftAssignment` yang aktif hari ini. |
| `ALREADY_CLOCKED_IN`   | Sudah clock in di window shift saat ini.                    |
| `NO_CLOCK_IN_TO_CLOSE` | Coba clock out padahal belum clock in.                      |
| `PAYROLL_LOCKED`       | Tanggal di ≤ `payrollLockedUntil`.                          |

**Leave (400 / 403 / 409)**

| Code                   | Kapan                                                      |
| ---------------------- | ---------------------------------------------------------- |
| `INSUFFICIENT_BALANCE` | Saldo cuti tidak cukup.                                    |
| `LEAVE_OVERLAP`        | Tanggal overlap dengan cuti existing.                      |
| `LEAVE_BEFORE_TODAY`   | Backdate tidak diizinkan (kecuali sick dengan attachment). |
| `INVALID_LEAVE_TYPE`   | Type tidak berlaku untuk role / department.                |
| `APPROVAL_LEVEL_WRONG` | Approver mencoba approve level yang bukan haknya.          |

**Overtime**

| Code                      | Kapan                              |
| ------------------------- | ---------------------------------- |
| `OVERTIME_OVERLAP`        | Slot overlap dengan OT existing.   |
| `OVERTIME_TOO_LONG`       | Durasi > max jam per hari.         |
| `OVERTIME_OUTSIDE_WINDOW` | Timestamp di luar toleransi shift. |

**Timesheet**

| Code                          | Kapan                                                  |
| ----------------------------- | ------------------------------------------------------ |
| `TIMESHEET_PERIOD_CLOSED`     | Period sudah locked oleh cutoff.                       |
| `TIMESHEET_ALREADY_SUBMITTED` | Tidak bisa edit setelah SUBMITTED.                     |
| `TIMESHEET_INVALID_STATE`     | Transisi state tidak legal (mis. reopen tanpa alasan). |

**Validasi & umum**

| Code                  | Status | Kapan                                       |
| --------------------- | ------ | ------------------------------------------- |
| `VALIDATION_FAILED`   | 400    | class-validator gagal — `details.fields[]`. |
| `NOT_FOUND`           | 404    | Resource tidak ditemukan.                   |
| `CONFLICT`            | 409    | Constraint DB / unique violation.           |
| `RATE_LIMITED`        | 429    | Throttler.                                  |
| `INTERNAL_ERROR`      | 500    | Unhandled; log ke Sentry.                   |
| `SERVICE_UNAVAILABLE` | 503    | Dependency (DB / S3 / SMTP) down.           |

---

## 4. Versioning + backward compatibility

- URI-based (`/api/v1`, `/api/v2` bila perlu). Tidak ada versioning via header.
- Breaking change → tambah `v2`, tidak menghapus `v1` selama minimal 2 minor
  releases. Tandai `v1` `Deprecated` di response header `X-API-Deprecated: true`.
- Non-breaking (menambah field, endpoint baru, menambah value di enum) →
  tetap `v1`, dokumentasikan di CHANGELOG.

Definisi breaking:

- Menghapus / rename field.
- Ubah tipe / semantik field.
- Ubah `code` error yang sudah dipublikasikan.
- Mengubah default behavior (mis. default TTL, default filter).

---

## 5. OpenAPI

Swagger UI **tidak** di-serve secara default di production karena alasan
keamanan (permukaan info). Untuk dev:

```bash
# jalankan API dengan flag Swagger enabled
API_ENABLE_SWAGGER=true pnpm --filter @workpulse/api dev
# → http://localhost:4000/api/docs
```

OpenAPI JSON: `GET /api/docs-json` (hanya bila flag aktif).

Client codegen (opsional): pakai `openapi-typescript` untuk generate
type-safe fetch client dari `docs-json`.

---

## 6. Contoh integrasi

### 6.1 Login flow (Node.js)

```ts
import { fetch } from 'undici';

const base = process.env.WP_API_URL ?? 'http://localhost:4000/api/v1';

async function login(email: string, password: string) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = (await res.json()) as { code: string; message: string };
    throw new Error(`${err.code}: ${err.message}`);
  }
  const { accessToken } = (await res.json()) as { accessToken: string };
  return accessToken;
}
```

### 6.2 Clock-in dari browser

```ts
async function clockIn() {
  const pos = await new Promise<GeolocationPosition>((res, rej) =>
    navigator.geolocation.getCurrentPosition(res, rej, {
      enableHighAccuracy: true,
      timeout: 10_000,
    }),
  );
  const res = await fetch('/api/v1/attendance/clock-in', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      timestamp: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    if (err.code === 'OUTSIDE_GEOFENCE') {
      showToast('Anda di luar lokasi kantor.');
      return;
    }
    throw err;
  }
}
```

### 6.3 Presign + upload attachment

```ts
const { uploadUrl, key } = await api.post('/attachments/presign-put', {
  filename: 'doctor-note.pdf',
  contentType: 'application/pdf',
});
await fetch(uploadUrl, { method: 'PUT', body: file });
await api.post('/leave', {
  leaveTypeId,
  startDate,
  endDate,
  reason,
  attachmentKey: key,
});
```

---

## 7. Testing endpoint

- **Unit test** (mock Prisma): pola `apps/api/src/<feature>/*.service.spec.ts`.
- **E2E** (real DB + HTTP): `apps/e2e/tests/*.spec.ts` — pakai
  `helpers/api.ts::authenticateApi` untuk bearer-armed request context.
- **Manual** — koleksi Postman/Insomnia belum di-check-in; untuk sementara
  pakai `curl` atau HTTPie:

  ```bash
  http POST :4000/api/v1/auth/login email=hr@acme.test password=password123
  export TOKEN='...'
  http :4000/api/v1/auth/me "Authorization:Bearer $TOKEN"
  ```

---

## 8. Deprecations & roadmap

Status endpoint terkini di [ROADMAP.md](./ROADMAP.md). Endpoint yang
**Deprecated** akan menampilkan header:

```
X-API-Deprecated: true
X-API-Sunset: 2026-11-01
X-API-Replacement: /api/v1/…
```

---

_Bila endpoint di kode tidak sesuai tabel ini, kode menang. Silakan kirim
PR memperbarui dokumen._
