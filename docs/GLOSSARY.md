# Glossary — Kamus Istilah Domain

Kamus istilah yang dipakai di Workpulse. Susunan A-Z. Bila ada istilah
yang belum ada di sini dan dipakai di > 1 dokumen, tambahkan.

Kolom **Padanan Kode** menampilkan nama tabel Prisma atau class/fungsi
utama di kode, supaya mudah dilacak.

---

## A

### Absence (Absensi tidak hadir)

Status hari kerja saat karyawan **tidak melakukan clock-in** sesuai shift-nya.
Dibedakan menjadi dua jenis:

- **Auto-absent** — di-detect scanner otomatis pada malam hari.
- **Manual absence** — di-mark HR/Admin dengan reason (mis. `SICK_NO_ATTACHMENT`).

Padanan Kode: `AbsenceRecord` (Prisma), `attendance-scanner.service.ts`.

### Accrual (Akumulasi saldo cuti)

Aturan penambahan saldo cuti secara periodik (bulanan / tahunan / lump-sum).
Config per `LeaveType`. Alternatif: **carry-over** (sisa saldo tahun lalu
di-carry ke tahun berjalan, dengan batas maksimum).

Padanan Kode: `LeaveType.accrualRule`, `leave-balance.service.ts`.

### AccuracyMeters (Akurasi GPS)

Nilai `accuracy` dari `navigator.geolocation.getCurrentPosition()`,
representasi radius uncertainty koordinat dalam meter. Server menolak
clock-in bila `accuracy > shift.geofence.maxAccuracyMeters` (default 50 m).
Menghindari false-positive dari GPS reading yang goyang.

Padanan Kode: `attendance.service.ts::validateAccuracy`.

### ADR (Architecture Decision Record)

Dokumen berisi konteks + keputusan + konsekuensi untuk satu keputusan
arsitektural signifikan. Format Michael Nygard. Semua ADR di
[`docs/ADR/`](./ADR/).

### Anonymization

Proses menghapus / mengganti PII user secara permanen. Dipicu oleh
right-to-erasure. Tidak sama dengan **soft delete** — anonymization
memusnahkan kaitan ke identitas user tapi mempertahankan record agregat
(mis. attendance count untuk audit).

Padanan Kode: `data-erasure.service.ts::anonymizeUser`.

### AttendanceRecord vs AttendanceEvent

- **Record** — aggregate per hari kerja, satu baris per (user, workDate).
  Menyimpan clock-in / clock-out yang aktif.
- **Event** — append-only trail, satu baris per aksi (`CLOCK_IN`,
  `CLOCK_OUT`, `CORRECTION_APPROVED`). Tidak boleh di-UPDATE / DELETE.

Padanan Kode: `AttendanceRecord`, `AttendanceEvent`.

### Audit Log

Catatan immutable dari perubahan sensitif (approval, override, admin
edit, geofence bypass). Ditulis dalam **transaksi yang sama** dengan
mutasi. `UPDATE` / `DELETE` di-`REVOKE` di level DB role.

Padanan Kode: `AuditLog`, `audit.service.ts::log`.

## B

### Backlog

Kumpulan permintaan yang menunggu keputusan approver. Halaman
`/admin/approvals/backlog` memilah **fresh** (< threshold) vs **stale**
(≥ threshold) — default 3 hari kerja.

Padanan Kode: `backlog.controller.ts`.

### Backup Codes (MFA)

Kode sekali-pakai (default 8 buah) yang di-issue saat user enroll TOTP.
Dipakai bila authenticator hilang. Setiap pemakaian sukses menandai kode
sebagai used dan menulis audit event.

Padanan Kode: `MfaBackupCode`, `mfa.service.ts`.

### Breach Notification Ledger

Register insiden kebocoran data yang wajib dilaporkan dalam 72 jam
(UU PDP Pasal 46). Menyimpan waktu detect, waktu notify, scope, mitigasi.

Padanan Kode: `SecurityBreach`, [ADR-0035](./ADR/ADR-0035-breach-notification-ledger.md).

## C

### Carry-over

Sisa saldo cuti dari tahun sebelumnya yang di-transfer ke tahun berjalan.
Biasanya bounded (mis. max 6 hari) dan expired setelah kuartal-1.

### Clock-in / Clock-out

Aksi karyawan menandai mulai (in) dan selesai (out) hari kerja. Server:

1. Validasi geofence (Haversine terhadap `Shift.geofence.center`).
2. Validasi accuracy (≤ `maxAccuracyMeters`).
3. Opsional: validasi Wi-Fi SSID (`ssid ∈ allowedSsids`).
4. Hitung lateness (`clockInAt` vs `Shift.startTime`).
5. Persist `AttendanceRecord` + `AttendanceEvent` dalam satu transaksi.

Padanan Kode: `attendance.controller.ts`, `attendance.service.ts`.

### Company (Tenant)

Root aggregate multi-tenancy. Setiap tabel domain wajib punya
`companyId`. User hanya bisa melihat / mengubah data di company-nya
sendiri, kecuali `SUPER_ADMIN` (yang aksesnya di-audit).

Padanan Kode: `Company`.

### Consent (Kesediaan pengolahan data)

Persetujuan user atas privacy policy versi tertentu. Bila HR/Admin
publish `PrivacyPolicy` versi baru, semua consent existing di-invalidasi
dan user diblok (`ConsentAcceptedGuard`) sampai accept versi baru.

Padanan Kode: `PrivacyPolicy`, `UserConsent`, `consent.controller.ts`.

### Correction (Koreksi absen)

Permintaan karyawan untuk mencatatkan clock-in/out yang terlewat.
Butuh approval supervisor / HR. Tidak berlaku untuk hari yang sudah
`payrollLockedUntil`.

Padanan Kode: `AttendanceCorrection`, [ADR-0011](./ADR/ADR-0011-attendance-correction.md).

### Cursor (Pagination cursor)

Opaque token yang meng-encode posisi terakhir di query. Client tidak
mem-parse; hanya meneruskan ke `?cursor=`. Format: base64url(JSON).

## D

### Department

Sub-unit di dalam Company. Membentuk hierarki reporting: `User.departmentId` →
`Department` → `Supervisor` (via `Department.headUserId`).

Padanan Kode: `Department`.

### DPIA (Data Protection Impact Assessment)

Analisis risiko sebelum memulai processing yang berpotensi high-risk
(UU PDP Pasal 31). Registered per aktivitas processing.

Padanan Kode: `Dpia`, [ADR-0032](./ADR/ADR-0032-dpia-registry.md).

### DSAR (Data Subject Access Request)

Hak user meminta salinan seluruh data pribadinya (UU PDP Pasal 26 huruf a).
Worker generate archive (JSON + attachment) → signed download URL.

Padanan Kode: `DataExportRequest`, [ADR-0020](./ADR/ADR-0020-data-export-dsar.md).

## E

### Effective Dating

Pola menyimpan **kapan** sebuah relasi berlaku, bukan hanya siapa relasi
nya. Dipakai untuk `UserShiftAssignment` (rotating shift), `LeaveType`
config, `PrivacyPolicy` versioning.

### Employee (Role terendah)

Role paling dasar; hanya bisa mengakses data sendiri (`/me/*`) dan
mengajukan permintaan.

## G

### Geofence

Boundary geografis (circle: center + radius) yang menandai lokasi kerja
sah. Selalu di-validasi server-side pakai formula Haversine.
Tier-2 sinyal (Wi-Fi SSID) opsional sebagai fallback saat GPS jelek.

Padanan Kode: `Geofence`, `attendance/domain/geofence.ts`, [ADR-0040](./ADR/ADR-0040-geofence-map-picker-and-tier2-signals.md).

### Grace Period (Right-to-erasure)

Interval antara HR approve erasure request dan worker benar-benar
menganonimkan data. Default 7 hari, bounded 1–30. Memberi user waktu
membatalkan.

Padanan Kode: env `DATA_ERASURE_GRACE_DAYS`.

## H

### Haversine

Formula menghitung jarak great-circle antara dua koordinat (lat/lng)
pada permukaan bola. Dipakai untuk hitung `distanceMeters` dari
koordinat user ke pusat geofence. Presisi meter di skala kota, cukup
untuk deteksi radius 50–500 m.

Padanan Kode: `attendance/domain/coordinates.ts::haversineDistance`.

### Holiday

Hari libur nasional / cuti bersama. Dipakai saat hitung durasi cuti
(hari libur tidak memotong balance) dan saat scheduler auto-absent
(scanner skip hari libur).

Padanan Kode: `Holiday`.

### HR Manager

Role menengah-atas — akses semua data company-nya (tidak lintas
tenant). Approver level-2 untuk cuti; single-level approver untuk
overtime; owner report / analytics; admin governance UU PDP.

## I

### Idempotency

Property operasi yang bila diulang menghasilkan efek yang sama seperti
sekali. Workpulse memakai idempotency di:

- Clock-in (window 60 detik).
- Webhook retry (`Idempotency-Key` header).
- Scanner run (`cursor`-based).

## J

### JWT (JSON Web Token)

Format token akses. Workpulse pakai HS256 signed dengan `JWT_SECRET`.
Payload: `{sub, role, companyId, sessionId, iat, exp}`. Refresh token
disimpan sebagai HttpOnly cookie, bukan JWT.

## L

### Lateness (Keterlambatan)

Selisih antara `clockInAt` dan `Shift.startTime`. Bila > 0, ditandai
`isLate=true`. Threshold toleransi (mis. 5 menit) di-config per shift.

Padanan Kode: `attendance/domain/shift-timing.ts::detectLateness`, [ADR-0007](./ADR/ADR-0007-attendance-lateness-detection.md).

### Leave Balance

Sisa saldo cuti user per `LeaveType`. Mutasi wajib atomic
(`SELECT ... FOR UPDATE` + optimistic `version` column) untuk mencegah
double-spending di approval race condition.

Padanan Kode: `LeaveBalance`.

### Leave Type

Kategori cuti (Annual, Sick, Marriage, dst.). Config per company:
accrual, carry-over, apakah butuh attachment, apakah butuh single vs
multi-level approval.

Padanan Kode: `LeaveType`.

## M

### MFA (Multi-Factor Authentication)

Faktor kedua saat login — TOTP (RFC 6238) via authenticator app
(Google Authenticator, Authy, 1Password). Secret di-encrypt dengan
AES-256-GCM (`MFA_SECRET_ENCRYPTION_KEY`) sebelum disimpan di DB.

Padanan Kode: `MfaSecret`, `mfa.service.ts`, [ADR-0017](./ADR/ADR-0017-mfa-totp.md).

### Migration (Prisma)

File SQL versi-controlled yang mengubah schema DB. Immutable setelah
di-merge; perubahan → migration file baru. Detail di [MIGRATIONS.md](./MIGRATIONS.md).

### Must-change-password

Flag `User.mustChangePassword` = `true` memaksa user ganti password
di login pertama / setelah admin reset. Guard `MustChangePasswordGuard`
memblok semua route lain kecuali `/auth/change-password`.

Padanan Kode: [ADR-0014](./ADR/ADR-0014-must-change-password.md).

## O

### Optimistic Locking

Strategi concurrency di mana update menyertakan `version` column dan
gagal (`P2025`) bila baris sudah dimodifikasi. Dipakai bersama
`SELECT ... FOR UPDATE` untuk `LeaveBalance`.

### OTP (One-Time Password)

Kode 6-digit yang di-generate authenticator setiap 30 detik.
Diverifikasi server dengan window ±1 slot (toleransi clock drift).

### Outbound Webhook

Notifikasi HTTP POST ke subscriber eksternal saat event tertentu terjadi
(mis. `leave.approved`). Delivery dengan retry backoff + SSRF hardening
(refuse loopback / private IP).

Padanan Kode: `Webhook`, `WebhookDelivery`, [ADR-0027](./ADR/ADR-0027-outbound-webhooks.md).

### Overtime

Kerja di luar jam shift, butuh pre-approval. Server hitung `ratePerHour`
dan `totalAmount` — client tidak boleh submit angka rupiah.

Padanan Kode: `OvertimeRequest`, [ADR-0005](./ADR/ADR-0005-overtime-completion-scheduler.md).

## P

### Payroll Cutoff (`payrollLockedUntil`)

Tanggal terakhir yang datanya sudah dikunci payroll. Modifikasi data
attendance/leave/overtime pada tanggal ≤ cutoff diblok (return
`403 PAYROLL_LOCKED`), kecuali `SUPER_ADMIN` override (audited).

Padanan Kode: `Company.payrollLockedUntil`, [ADR-0010](./ADR/ADR-0010-payroll-cutoff.md).

### PDP (UU Pelindungan Data Pribadi)

Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi.
Basis semua fitur privacy: DSAR, right-to-erasure, ROPA, DPIA,
retention, konsen, breach notification.

### Presigned URL

URL S3 / MinIO yang di-sign oleh backend dengan TTL terbatas.
Pola: client PUT langsung ke storage (bypass API bandwidth), lalu
kirim `key` ke API sebagai bukti upload berhasil.

Padanan Kode: [ADR-0004](./ADR/ADR-0004-attachment-strategy.md).

### PrivacyPolicy

Versioned document yang harus di-accept user. Publishing versi baru
memaksa semua user re-accept (`ConsentAcceptedGuard`).

## R

### RBAC (Role-Based Access Control)

Model otorisasi Workpulse. Empat role kanonik: EMPLOYEE, SUPERVISOR,
HR_MANAGER, SUPER_ADMIN. Enforce di dua level:

1. **Route-level** — `@Roles(...)` di controller + `RolesGuard`.
2. **Row-level** — tenant filter (`companyId`) + own-data filter di query.

### Refresh Token

Long-lived token (7 hari) yang bisa menerbitkan access token baru.
Disimpan sebagai HttpOnly cookie `wp_rt`, di-rotate setiap sukses refresh.

### Reopen (Timesheet)

Mengubah timesheet yang sudah `APPROVED` kembali ke `SUBMITTED` untuk
koreksi. Butuh alasan; ditulis ke AuditLog.

Padanan Kode: [ADR-0029](./ADR/ADR-0029-timesheet-reopen.md).

### Retention

Kebijakan berapa lama data disimpan sebelum dihapus otomatis. Config
per kategori data (attendance, leave, audit log). Worker sweep harian.

Padanan Kode: `RetentionConfig`, `retention-worker.service.ts`.

### Right-to-Erasure

Hak user meminta datanya dihapus (UU PDP Pasal 26 huruf b). Alur:
request → HR approve → grace period → worker anonymize.

Padanan Kode: `DataErasureRequest`, [ADR-0021](./ADR/ADR-0021-right-to-erasure.md).

### ROPA (Record of Processing Activities)

Register aktivitas processing data pribadi yang dilakukan Workpulse
(UU PDP Pasal 20). Wajib disimpan dan bisa diaudit.

Padanan Kode: `RopaEntry`, [ADR-0030](./ADR/ADR-0030-ropa-registry.md).

## S

### Scanner (Auto-absent)

Worker cron malam yang scan semua user × shift × tanggal untuk membuat
`AbsenceRecord` bagi yang tidak clock-in. Idempotent via cursor;
skip hari libur & user cuti approved.

Padanan Kode: `attendance-scanner.service.ts`, [ADR-0008](./ADR/ADR-0008-auto-absent-and-hr-dashboard.md).

### Security Policy (per tenant)

Konfigurasi security level company: `mfaEnforceHighPrivileged` (paksa
MFA untuk HR/Admin), password policy, session TTL. Diedit `SUPER_ADMIN`
via `/admin/security/policy`.

Padanan Kode: `SecurityPolicy`, [ADR-0017 Rev 2](./ADR/ADR-0017-mfa-totp.md).

### Shift

Definisi jadwal kerja: start/end time, break, days-of-week, tipe
(STATIC / FLEXIBLE / ROTATING), geofence, tolerance untuk lateness.

Padanan Kode: `Shift`.

### Signed URL (Timesheet share)

URL download timesheet export yang di-sign HMAC-SHA256 dengan
`TIMESHEET_EXPORT_SIGNING_SECRET`. TTL bounded (default 24 jam, max 168 jam).

Padanan Kode: `TimesheetExport.shareToken`.

### SSID (Wi-Fi Service Set Identifier)

Nama Wi-Fi. Dipakai sebagai Tier-2 signal saat clock-in untuk
memverifikasi user benar berada di kantor bila GPS accuracy jelek.
Diaktifkan bila `Geofence.allowedSsids` non-empty.

Padanan Kode: [ADR-0040](./ADR/ADR-0040-geofence-map-picker-and-tier2-signals.md).

### Super Admin

Role tertinggi. Bisa lintas tenant. Setiap aksi cross-tenant
otomatis ditulis ke AuditLog. Direkomendasikan MFA-enforced.

### Supervisor

Role menengah. Approver level-1 cuti; melihat data tim; tidak melihat
lintas department (kecuali di-config sebagai head).

## T

### Tenant

Sinonim informal untuk **Company**. "Multi-tenant" = mendukung
multiple Company di satu instance API.

### Timesheet

Record jam kerja per (user, periode). Alur: DRAFT → SUBMITTED → APPROVED
(atau REJECTED, atau REOPENED). Basis untuk export payroll.

Padanan Kode: `Timesheet`, `TimesheetPeriod`, [ADR-0023](./ADR/ADR-0023-timesheet-foundation.md).

### TOTP (Time-based One-Time Password)

Standar RFC 6238. Basis kode 6-digit di authenticator app.

## U

### UAT (User Acceptance Test)

Verifikasi manual bahwa aplikasi memenuhi spesifikasi bisnis, dijalankan
oleh stakeholder (bukan engineer) sebelum go-live. Skenario di
[UAT-E2E.md](./UAT-E2E.md).

### UserShiftAssignment

Relasi banyak-ke-banyak antara `User` dan `Shift` dengan
`effectiveFrom` / `effectiveTo`. Mendukung rotating shift.

Padanan Kode: `UserShiftAssignment`.

## V

### Versioning (API)

URI-based. Semua route saat ini di `/api/v1`. Breaking change → tambah
`v2` tanpa menghapus `v1` sementara.

### Vendor / Processor Register

Daftar vendor pihak ketiga yang memproses data pribadi user (UU PDP
Pasal 25). Contoh: SendGrid untuk email, Cloudflare R2 untuk backup.
Punya reminder review T-30d dan contract-expiring T-60d.

Padanan Kode: `VendorProcessor`, [ADR-0038](./ADR/ADR-0038-vendor-processor-register.md).

## W

### Webhook Delivery

Satu event dispatch ke satu subscriber. Punya `attemptCount`,
`nextAttemptAt`, `status` (PENDING / DELIVERED / FAILED). Retry
backoff exponential.

Padanan Kode: `WebhookDelivery`.

### WIB (Waktu Indonesia Barat)

UTC+7. Timezone default aplikasi (`APP_TIMEZONE=Asia/Jakarta`).

### Workspace (pnpm workspace)

Sub-package di monorepo. Workpulse punya: `apps/api`, `apps/web`,
`apps/e2e`, `apps/load-test`, `packages/shared-types`, `packages/config`.

## Z

### Zod

Schema validation library. Dipakai di `packages/shared-types/` untuk
mendefinisikan schema yang shared antara backend (via `zod-to-json-schema`
atau native) dan frontend (via `zodResolver` + React Hook Form).

Padanan Kode: `packages/shared-types/src/*.ts`.

---

## Singkatan cepat

| Singkatan  | Kepanjangan                                                      |
| ---------- | ---------------------------------------------------------------- |
| ADR        | Architecture Decision Record                                     |
| AES-GCM    | Advanced Encryption Standard — Galois/Counter Mode (256-bit key) |
| API        | Application Programming Interface                                |
| CSP        | Content Security Policy                                          |
| CVE        | Common Vulnerabilities and Exposures                             |
| DDD        | Domain-Driven Design                                             |
| DPIA       | Data Protection Impact Assessment                                |
| DPO        | Data Protection Officer                                          |
| DSAR       | Data Subject Access Request                                      |
| DTO        | Data Transfer Object                                             |
| GHCR       | GitHub Container Registry                                        |
| GHSA       | GitHub Security Advisory                                         |
| HMAC       | Hash-based Message Authentication Code                           |
| HSTS       | HTTP Strict Transport Security                                   |
| HTTP/HTTPS | Hypertext Transfer Protocol / Secure                             |
| JWT        | JSON Web Token                                                   |
| KMS        | Key Management Service                                           |
| MFA        | Multi-Factor Authentication                                      |
| ORM        | Object-Relational Mapping                                        |
| OTP        | One-Time Password                                                |
| PDP        | UU Pelindungan Data Pribadi (No. 27/2022)                        |
| PII        | Personally Identifiable Information                              |
| RBAC       | Role-Based Access Control                                        |
| REST       | Representational State Transfer                                  |
| ROPA       | Record of Processing Activities                                  |
| RSC        | React Server Components                                          |
| SBOM       | Software Bill of Materials                                       |
| SLA        | Service Level Agreement                                          |
| SLO        | Service Level Objective                                          |
| SLSA       | Supply-chain Levels for Software Artifacts                       |
| SMB        | Small-to-Medium Business                                         |
| SMTP       | Simple Mail Transfer Protocol                                    |
| SPA        | Single-Page Application                                          |
| SQL        | Structured Query Language                                        |
| SSRF       | Server-Side Request Forgery                                      |
| SSID       | Service Set Identifier (nama Wi-Fi)                              |
| TLS        | Transport Layer Security                                         |
| TOTP       | Time-based One-Time Password (RFC 6238)                          |
| TTL        | Time To Live                                                     |
| UAT        | User Acceptance Test                                             |
| VPS        | Virtual Private Server                                           |
| WAF        | Web Application Firewall                                         |
| WIB        | Waktu Indonesia Barat (UTC+7)                                    |

---

_Tambahkan entri baru sesuai abjad. Jangan hapus entri hanya karena istilah
"terlihat jelas" — glossary untuk kolega baru, bukan untuk yang sudah tahu._
