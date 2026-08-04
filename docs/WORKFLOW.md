# Business Workflows — Workpulse

Dokumen ini mendefinisikan alur bisnis inti. Perubahan alur **wajib** disertai update dokumen ini pada PR yang sama.

## 0. Autentikasi (Auth)

### 0.1 Login

```
POST /api/v1/auth/login { email, password }
  ↓ @Public() + Throttle(5/min per IP)
  ↓
AuthService.login
  ├── Normalisasi email (trim + lowercase)
  ├── prisma.user.findFirst  → jika tidak ada, tetap panggil argon2.verify pada
  │                            hash palsu (konstan-waktu, cegah account enumeration)
  ├── argon2.verify(hash, password)                  → 401 UNAUTHORIZED
  ├── Cek employmentStatus ∈ {SUSPENDED, TERMINATED} → 401 UNAUTHORIZED
  ├── argon2.needsRehash → rehash + update user (opportunistic)
  ├── TokenService.issueForLogin
  │     ├── sign JWT access (15m) dgn { sub, email, companyId, departmentId, role }
  │     └── generate opaque refresh secret (48B), simpan SHA-256 hash + familyId=row.id
  ├── AuditLog(AUTH_LOGIN)
  └── Set-Cookie: wp_refresh=<opaque>; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth
  ↓
200 OK → { accessToken, accessTokenExpiresIn, user }
```

### 0.2 Refresh (Auto-Rotasi)

```
POST /api/v1/auth/refresh  (dengan cookie wp_refresh)
  ↓ @Public() + Throttle(30/min per IP)
  ↓
TokenService.rotate
  ├── SHA-256(cookie) → cari refresh_tokens
  ├── Jika tidak ditemukan                     → 401 UNAUTHORIZED
  ├── Jika status ∈ {ROTATED, REVOKED}         → REUSE DETECTED:
  │     revoke SELURUH family, log warning
  │     → 401 UNAUTHORIZED
  ├── Jika expired                             → mark REVOKED → 401
  ├── Jika user dihapus/di-soft-delete         → 401
  └── prisma.$transaction:
        • create refresh_tokens baru (ACTIVE, familyId sama, replacedById link)
        • update refresh_tokens lama ke ROTATED (revokedAt = now)
        • sign access JWT baru
  ↓
200 OK → { accessToken, accessTokenExpiresIn }
Set-Cookie: wp_refresh=<opaque-baru>
```

### 0.3 Logout / Logout-All

- **`POST /auth/logout`** (public, no bearer needed) — revoke refresh_tokens berdasarkan cookie, hapus cookie. Access token yang masih hidup di browser akan expire sendiri dalam ≤ 15m.
- **`POST /auth/logout-all`** — butuh JWT valid. Revoke SEMUA refresh_tokens milik user (dipakai saat ganti password / suspicious activity).

### 0.4 Access-Token Storage (Frontend)

Access token disimpan **in-memory** (`apps/web/lib/auth-store.ts`) — bukan `localStorage`, bukan cookie. Pada reload page:

1. `AuthProvider` (mount) memanggil `POST /auth/refresh` → cookie HttpOnly re-establish session.
2. Ambil `/auth/me` untuk populate `user`.
3. Jika refresh gagal → redirect ke `/login`.

Auto-refresh saat 401:

- `apiRequest` interceptor: pada `401` pertama, panggil `/auth/refresh`. Jika sukses, retry request. Jika gagal, `authStore.clear()` → UI redirect ke `/login`.
- Concurrent 401 dari beberapa request paralel share satu refresh promise (`refreshInFlight`) untuk mencegah thundering-herd.

### 0.5 Error Codes

| Code            | HTTP | UI Copy (ID)                                       |
| --------------- | ---- | -------------------------------------------------- |
| `UNAUTHORIZED`  | 401  | Email atau kata sandi salah.                       |
| `FORBIDDEN`     | 403  | Anda tidak memiliki akses.                         |
| `THROTTLED`     | 429  | Terlalu banyak percobaan. Silakan coba lagi nanti. |
| `INVALID_TOKEN` | 400  | Link reset ini tidak valid atau sudah kedaluwarsa. |

### 0.6 Password Recovery (Forgot Password → Reset Link)

Alur "lupa password" berjalan sepenuhnya lewat email dengan token single-use.

```
User (browser, belum login)
  ↓ POST /api/v1/auth/forgot-password { email }
  ↓
API
  ↓ Cari User by email (case-insensitive)
  ↓ Jika User ada & ACTIVE:
  │   ├─ generate 48-byte random → base64url (rawToken)
  │   ├─ insert PasswordResetToken (userId, tokenHash=SHA256(rawToken), expiresAt=+30m)
  │   └─ email adapter.send({
  │        to: user.email,
  │        subject: "Reset password Workpulse",
  │        body: "... {WEB_URL}/reset-password?token={rawToken} ..."
  │      })
  ↓ (Selalu, apa pun hasil pencarian di atas)
  → 202 Accepted { message: "Jika email tersebut terdaftar, kami telah mengirimkan link reset password." }
```

**No-user-enumeration invariant.** Response body untuk email tidak
terdaftar **identik** dengan email valid. Server juga melakukan sedikit
kerja hashing pada path "email tidak dikenal" untuk menyamakan timing.
Frontend menampilkan pesan sukses yang sama.

Reset:

```
User (browser)
  ↓ GET /reset-password?token=... (Next.js page, tidak diindex, robots meta)
  ↓ isi password + konfirmasi
  ↓ POST /api/v1/auth/reset-password { token, password }
  ↓
API
  ↓ Validate bentuk token (base64url, 40..128 char)
  ↓ Cari PasswordResetToken by tokenHash=SHA256(token)
  ↓ Reject jika: tidak ada / usedAt != null / expiresAt < now / user
  │              deleted / user TERMINATED|SUSPENDED
  ↓ prisma.$transaction:
  │   ├─ passwordResetToken.updateMany({ id, usedAt: null } → { usedAt: now })   ← guard race
  │   ├─ user.update({ passwordHash: argon2id(newPassword) })
  │   ├─ refreshToken.updateMany({ userId, status: ACTIVE } → REVOKED)          ← kick every device
  │   ├─ auditLog.create({ action: 'AUTH_PASSWORD_RESET', ip, userAgent })
  │   └─ notification.createOne({ type: PASSWORD_RESET, recipientId, recipientEmail })
  ↓ passwordResetToken.updateMany({ userId, usedAt: null } → { usedAt: now })    ← invalidate outstanding
  ↓ res.clearCookie(wp_refresh)
  → 200 OK { message: "Password Anda telah berhasil diubah." }
```

**Semantik penting:**

| Aspek                | Perilaku                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Token TTL            | 30 menit sejak dibuat                                                                                      |
| Single-use           | `usedAt` di-set atomik dalam transaction; reuse → `INVALID_TOKEN`                                          |
| Race handling        | Guard `updateMany` dengan predikat `usedAt: null` → dua request paralel: satu sukses, satu `INVALID_TOKEN` |
| Session invalidation | **Semua** refresh token aktif user di-`REVOKE` — kicks user out di semua device                            |
| Cookie cleanup       | Cookie `wp_refresh` di browser yang mengirim request juga di-`clearCookie`                                 |
| Outstanding tokens   | Reset sukses meng-`used` semua token lain milik user (attacker's link jadi mati juga)                      |
| Rate limit           | Forgot: 5/menit per IP · Reset: 10/menit per IP                                                            |
| Audit                | `AuditLog` action `AUTH_PASSWORD_RESET` (actor = user sendiri)                                             |
| Notification         | In-app `PASSWORD_RESET` + email konfirmasi (tanpa link, informatif; berisi IP + user-agent hint)           |
| Temp password        | Reset password otomatis mengakhiri state "temp password from HR" (tidak ada flag terpisah)                 |

**Config env:**

| Var               | Default                 | Catatan                                      |
| ----------------- | ----------------------- | -------------------------------------------- |
| `WEB_URL`         | `http://localhost:3000` | Base URL yang di-embed di email reset link   |
| `EMAIL_TRANSPORT` | `console`               | `console` \| `disabled` \| `smtp` (lihat §9) |

**Frontend routes:**

| Path                        | Deskripsi                                                      |
| --------------------------- | -------------------------------------------------------------- |
| `/forgot-password`          | Form request reset — success screen generik (tidak leak state) |
| `/reset-password?token=...` | Form password baru + konfirmasi; `robots: noindex`             |
| `/login`                    | Link "Lupa password?" di sebelah label password                |

### 0.7 Self-Service Change Password + Temp-Password Enforcement

**Konteks.** Setiap admin-issued temporary password (dari `POST /admin/users`
atau `POST /admin/users/:id/reset-password`) menghidupkan flag
`User.mustChangePassword = true`. Selama flag menyala, seluruh endpoint di
luar white-list `/auth/*` ditolak dengan 403 `PASSWORD_CHANGE_REQUIRED` — user
**harus** melakukan self-service rotation sebelum bisa memakai sistem.
Referensi arsitektural: [ADR-0014](./ADR/ADR-0014-must-change-password.md).

**Endpoint baru:**

```
POST /api/v1/auth/change-password (Bearer required)
  ↓ @AllowMustChangePassword() + Throttle(5/min per IP)
  ↓
AuthService.changePassword
  ├── Validasi: currentPassword ≠ newPassword           → 400 SAME_PASSWORD
  ├── prisma.user.findFirst({ id, deletedAt: null })    → 401 INVALID_CREDENTIALS jika hilang
  ├── password.verify(user.passwordHash, current)       → 401 INVALID_CREDENTIALS jika salah
  │   (kode error sama untuk "user tidak ada" dan "password salah"
  │    — cegah account enumeration dari access token yang bocor)
  ├── password.hash(newPassword)
  ├── prisma.$transaction:
  │     ├── user.update: passwordHash, mustChangePassword=false
  │     └── auditLog.create(AUTH_PASSWORD_CHANGED, { ip, userAgent })
  └── tokens.revokeAllForUser(userId, 'PASSWORD_CHANGED_SELF')
      → SEMUA sesi (termasuk device saat ini) di-revoke
  ↓
200 OK { message } + Set-Cookie: wp_refresh=; expires=1970 (clear)
```

**Guard global.**

```
MustChangePasswordGuard  (registered AFTER JwtAuthGuard, BEFORE RolesGuard)
  ├── Skip jika route @Public() atau @AllowMustChangePassword()
  ├── Skip jika req.user tidak ada (biarkan JwtAuthGuard yang menolak)
  └── req.user.mustChangePassword === true  → 403 PASSWORD_CHANGE_REQUIRED
```

Endpoint di allowlist (`@AllowMustChangePassword()`):

- `POST /auth/change-password` — escape hatch itu sendiri
- `GET /auth/me` — FE bootstrap perlu baca flag
- `POST /auth/logout`, `POST /auth/logout-all` — user bisa abandon sesi

**Transisi flag:**

| Event                                           | `mustChangePassword` |
| ----------------------------------------------- | -------------------- |
| `POST /admin/users`                             | `true`               |
| `POST /admin/users/:id/reset-password`          | `true` (re-armed)    |
| `POST /auth/change-password` sukses             | `false`              |
| `POST /auth/reset-password` (email-link) sukses | `false`              |

**Frontend behavior.**

- **Login flow.** `LoginForm.onSubmit` membaca `res.user.mustChangePassword`
  lalu memilih redirect target: `/change-password` jika `true`, `redirectTo`
  (default `/attendance`) jika `false`.
- **RequireAuth wrapper.** Mengecek flag di setiap render — kalau `true` dan
  pathname bukan `/change-password`, `router.replace('/change-password')`.
  Anak-anak tidak di-render selama pengalihan (jika di-render, semua fetch
  bakal 403).
- **`/change-password` page.** Route di grup `(auth)` — tidak ada dashboard
  chrome. Menampilkan banner "password sementara" hanya bila flag menyala;
  form yang sama dipakai untuk voluntary rotation (banner disembunyikan).
- **Post-submit.** Setelah 200, `authStore.clear()` + `router.replace('/login?changed=1')`.
  Halaman `/login` men-detect `?changed=1` dan menampilkan toast konfirmasi.
- **User menu.** Ada link "Ubah password" di header (voluntary path).

**Wire contract:**

```
LoginResponse.user = {
  id, email, companyId, departmentId, role,
  mustChangePassword: boolean   ← baru
}

GET /auth/me  → shape identik LoginResponse.user
```

**Error codes:**

- `PASSWORD_CHANGE_REQUIRED` (403) — flag menyala, endpoint bukan allowlisted
- `INVALID_CREDENTIALS` (401) — currentPassword salah / user hilang
- `SAME_PASSWORD` (400) — currentPassword === newPassword
- `THROTTLED` (429) — throttle limit tercapai

**Frontend routes:**

| Path               | Deskripsi                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `/change-password` | Form ubah password. Force-render untuk `mustChangePassword=true`, opsional untuk voluntary. `robots: noindex`. |
| `/login?changed=1` | Login page dengan toast "Password berhasil diubah, silakan masuk kembali".                                     |

**Ops notes:**

- `env.validation.ts` menolak kombinasi `NODE_ENV=production` +
  `THROTTLER_DISABLED=true`. E2E harness set `THROTTLER_DISABLED=true` di
  `playwright.config.ts webServer.api.env` untuk lewati rate-limit login;
  di dev boleh diaktifkan bila perlu banyak login berturut-turut.
- Migrasi `20260802120000_add_must_change_password/migration.sql` menambahkan
  kolom dengan `DEFAULT false` — user existing tidak terpengaruh.

### 0.8 Tenant Onboarding (SUPER_ADMIN Cross-Tenant Company CRUD)

**Konteks.** Sebelumnya, satu-satunya tenant di sistem adalah yang dibuat
oleh `prisma db seed`. Onboarding customer baru butuh SQL manual atau
edit seed — bukan cara yang aman untuk produksi. Fase 29 menambahkan
CRUD `Company` lintas-tenant yang **hanya bisa diakses SUPER_ADMIN**.

**Isolasi path.** Ada dua controller Company yang sengaja dipisahkan:

| Path                              | Role    | Scope                    |
| --------------------------------- | ------- | ------------------------ |
| `PATCH /admin/company` (singular) | HR, SA  | Tenant sendiri (config)  |
| `POST /admin/companies` (plural)  | SA only | **Lintas-tenant** (CRUD) |

URL berbeda → guard mis-config tidak bisa diam-diam nyasar.

**Alur create tenant** (`POST /admin/companies`):

```
SUPER_ADMIN
  ↓ POST /admin/companies { name, hrEmail, hrFullName, timezone?, slug? }
  ↓
CompanyAdminService.create()
  ├── assertSuperAdmin(actor)                      → 403 SUPER_ADMIN_REQUIRED
  ├── assertValidTimezone(input.timezone)          → 400 INVALID_TIMEZONE
  ├── Resolve slug:
  │     • explicit → validasi format + cek unik    → 409 SLUG_ALREADY_TAKEN
  │     • omitted  → derivateSlug(name) + bumper   → guaranteed unique
  ├── Cek email HR global-unique                   → 409 EMAIL_ALREADY_TAKEN
  ├── temporaryPassword = generateTempPassword(14)
  ├── passwordHash = argon2id.hash(temporaryPassword)
  └── prisma.$transaction:
        • create Company { name, slug, timezone }
        • create 3 × LeaveType (ANNUAL 12, SICK 14, PERSONAL 3)
        • create User { role=HR_MANAGER, mustChangePassword=true, passwordHash }
        • createMany LeaveBalance untuk HR pada tahun berjalan
        • create AuditLog { companyId: actor.companyId, action: COMPANY_CREATED }
  → 201 { company, hrUserId, hrEmail, temporaryPassword, seededLeaveTypeCodes }
```

**Guardrails penting:**

- **Bootstrap atomik.** Salah satu langkah gagal → seluruh transaksi rollback.
  Tidak ada "tenant setengah jadi".
- **HR pertama `mustChangePassword=true`.** SUPER_ADMIN dapat temp password
  **sekali** di response (tidak persisten), lalu HR harus rotasi lewat
  `/change-password` di login pertama (lihat §0.7).
- **AuditLog di tenant caller.** `companyId` di baris audit adalah
  `actor.companyId` (bukan tenant baru) supaya jejak lintas-tenant
  terkumpul di timeline SUPER_ADMIN yang bisa dibaca via Audit Viewer.
- **Self-delete refused.** `DELETE /admin/companies/:ownTenant` → 403
  `CANNOT_DELETE_OWN_TENANT`. Kalau tidak, sesi SA sendiri akan langsung
  invalid dan tidak ada jalur "un-brick" via API.
- **Active-user gate.** Soft-delete refuses dengan 409
  `COMPANY_HAS_ACTIVE_USERS` bila masih ada user aktif. Operator wajib
  deactivate mereka via `/admin/users` dulu. Ini mencegah lockout senyap.

**Endpoints:**

| Method | Path                           | Effect                                    |
| ------ | ------------------------------ | ----------------------------------------- |
| POST   | `/admin/companies`             | Create + bootstrap. Return temp pw.       |
| GET    | `/admin/companies`             | Offset-paginated list + search.           |
| GET    | `/admin/companies/:id`         | Detail with counts.                       |
| PATCH  | `/admin/companies/:id`         | Update `name`/`slug`/`timezone`.          |
| DELETE | `/admin/companies/:id`         | Soft-delete (guardrail: no active users). |
| POST   | `/admin/companies/:id/restore` | Restore soft-deleted tenant.              |

**Impersonate (SUPER_ADMIN "switch tenant") sengaja belum ada** di fase ini.
Audit story-nya nontrivial (baris `AuditLog.actorId` tetap SA, tapi UI perlu
marker supaya HR tidak salah paham); dipertimbangkan di fase berikutnya.
Lihat [ADR-0016](./ADR/ADR-0016-multi-tenant-admin-and-observability.md).

**Frontend `/admin/companies` (Fase 29b).** Halaman baru khusus SUPER_ADMIN:

- Tab **"Tenant"** hanya muncul di admin sub-nav untuk SUPER_ADMIN
  (`admin-subnav.tsx` memfilter berdasarkan role user aktif).
- Halaman digated ganda: layout `<RequireRole roles={['HR_MANAGER','SUPER_ADMIN']}>`
  dari `(dashboard)/admin/layout.tsx` **plus** guard lokal
  `<RequireRole roles={['SUPER_ADMIN']}>` di `page.tsx` — HR yang
  bookmark URL akan lihat panel "tidak memiliki akses" alih-alih
  halaman rusak.
- **Alur create:** tombol **+ Tambah tenant** → form (name, slug opsional,
  timezone, HR name + email) → submit → API return `temporaryPassword`
  sekali → `<CredentialReveal>` menampilkan email + password (masked
  default, tombol Tampilkan/Salin) → operator dismiss → password
  **hilang permanen dari FE**, tidak pernah masuk `localStorage` atau
  cache React Query.
- **Alur edit:** klik "Edit" di baris → panel inline (name / slug /
  timezone) → submit hanya field yang berubah (diff seperti pola
  `CompanyConfigForm`).
- **Alur soft-delete:** klik "Nonaktifkan" → konfirmasi `window.confirm`
  → jika API 409 `COMPANY_HAS_ACTIVE_USERS`, error text di panel top
  memberi tahu operator "nonaktifkan seluruh karyawan lebih dulu".
  Tombol Nonaktifkan **disabled** untuk baris tenant sendiri (badge
  "Sendiri") → guard client-side ini konsisten dengan 403 server
  `CANNOT_DELETE_OWN_TENANT`.
- **Restore:** untuk tenant yang sudah di-soft-delete (baris opasitas
  turun + status "Dinonaktifkan"), tombol "Aktifkan kembali"
  menggantikan Nonaktifkan.

E2E UI: `apps/e2e/tests/company-admin-ui.spec.ts` — 4 test (happy path
create → reveal → edit → guarded delete; self-tenant disabled; HR
tanpa tab; HR direct-nav ditolak).

### 0.9 Observability Lite — Structured Logs + Sentry

Backend memakai [`nestjs-pino`](https://github.com/iamolegga/nestjs-pino)
menggantikan `Logger` bawaan Nest:

- **Output JSON** di production; `pino-pretty` di dev (kendalikan via
  `LOG_PRETTY=true`).
- **`requestId`** disuntikkan dari header `X-Request-Id` (kalau ada) atau
  di-generate UUID baru. Header sama di-echo ke response — client bisa
  bawa untuk korelasi.
- **`userId`, `companyId`, `role`** otomatis nempel setiap log line setelah
  `JwtAuthGuard` mengisi `req.user`.
- **Redaction** di serializer — bidang berikut **tidak pernah** keluar ke log:
  - `req.headers.authorization`, `req.headers.cookie`, `set-cookie`
  - `req.body.password`, `currentPassword`, `newPassword`, `refreshToken`, `token`

Sentry via `@sentry/nestjs` (v8+):

- Diinit di `apps/api/src/instrument.ts`, di-import **paling atas** di
  `main.ts` supaya OpenTelemetry wrapping menangkap http/express/prisma
  sebelum modul lain dibutuhkan.
- Dinyalakan bila `SENTRY_DSN` ada. Kosong → seluruh SDK jadi no-op.
- **Per-request user context** di `JwtStrategy.validate` (`id`, `email`,
  `companyId`, `role`).
- **4xx di-drop** di `beforeSend` — noise validation/permission bukan
  incident.
- Unhandled non-HttpException di-capture di `AllExceptionsFilter`.

Env vars (semua opsional, default aman):

```
LOG_LEVEL=info
LOG_PRETTY=false
SENTRY_DSN=
SENTRY_ENVIRONMENT=development
SENTRY_RELEASE=
SENTRY_TRACES_SAMPLE_RATE=0
```

### 0.10 Multi-Factor Authentication (TOTP + Backup Codes)

Sesudah login password sukses, tergantung state akun user, session bisa
masuk ke salah satu gate berikut sebelum bisa memakai aplikasi:

```
POST /auth/login  →  mustChangePassword? → /change-password
                 →   mfaEnabled ∧ ¬mfaPassed? → /login/mfa
                 →   mfaEnrollmentRequired?   → /setup-mfa   (HR / SUPER_ADMIN wajib)
                 →   redirect target (default /attendance)
```

Semua gate di atas **juga** ada di backend sebagai NestJS guards global
(`MustChangePasswordGuard` → `MfaVerifiedGuard` → `MfaEnrollmentGuard` →
`RolesGuard`) — FE cuma memantul untuk UX. Bila FE bug/di-bypass, API
tetap tolak dengan `code` yang sesuai (`PASSWORD_CHANGE_REQUIRED`,
`MFA_REQUIRED`, `MFA_ENROLLMENT_REQUIRED`).

#### 0.10.1 Kebijakan

| Peran                   | MFA                                                                     |
| ----------------------- | ----------------------------------------------------------------------- |
| EMPLOYEE, SUPERVISOR    | **Opsional** (voluntary via `/settings/security`)                       |
| HR_MANAGER, SUPER_ADMIN | **Wajib** — belum enroll = akses dikunci ke `/setup-mfa` sampai selesai |

Env `MFA_ENFORCE_HR_ADMIN=false` (test-only; ditolak di production oleh
`env.validation.ts`) mematikan gate untuk HR/SA.

#### 0.10.2 Enrollment (mandatory ATAU voluntary)

```
POST /auth/mfa/enroll/start   (Bearer, @AllowMfaEnrollmentPending)
   → { otpauthUrl, qrCodeDataUri, secret }

User scans QR → authenticator app menampilkan 6-digit code

POST /auth/mfa/enroll/confirm { code: "123456" }
   → { backupCodes: string[8], accessToken, accessTokenExpiresIn }
```

- Secret di-encrypt AES-256-GCM di layer aplikasi memakai
  `MFA_SECRET_ENCRYPTION_KEY` sebelum di-write ke `User.mfaSecret`.
- Backup codes ditampilkan **sekali** di response. FE wajib pakai
  `MfaBackupCodesReveal` yang menawarkan salin ke clipboard.
- Response ganti access token supaya klaim `mfaEnabled=true` dan
  `mfaPassed=true` — user langsung siap pakai aplikasi tanpa relogin.

#### 0.10.3 Login → MFA Step-Up

```
POST /auth/login (email, password)
   → { accessToken, mfaRequired: true, user: { mfaEnabled: true, mfaPassed: false } }

User isi TOTP 6-digit ATAU backup code:

POST /auth/mfa/verify
   Body: { code: "123456" }        // TOTP
   ATAU: { backupCode: "ABCD1234" } // one-time
   → { accessToken, accessTokenExpiresIn, usedBackupCode }
```

Rules:

- Access token pre-MFA hanya diterima di `/auth/mfa/verify`,
  `/auth/me`, `/auth/logout*`, `/auth/change-password`. Semua endpoint
  lain balikin `403 { code: "MFA_REQUIRED" }`.
- Backup code habis pakai (satu kali) — `usedAt` di-set atomically di
  transaction. Replay = `MFA_INVALID_CODE`.
- Refresh token yang di-mint saat login carrier `mfaVerified=false`;
  rotate ke `mfaVerified=true` hanya via `/auth/mfa/verify` (tidak bisa
  disambungin lewat `/auth/refresh` biasa).

#### 0.10.4 Manajemen (Regenerate, Disable)

Semua di `/settings/security` (page baru) — panel `MfaManagementPanel`:

- **Regenerate backup codes** — butuh TOTP saat ini:

  ```
  POST /auth/mfa/backup-codes/regenerate { code: "123456" }
  → { backupCodes: string[8] }
  ```

  Kode lama langsung tidak berlaku (dihapus dalam satu transaction).

- **Disable MFA** — butuh password saat ini **DAN** TOTP:

  ```
  DELETE /auth/mfa { currentPassword, code }
  → 204 No Content
  ```

  Setelah sukses, `mfaSecret` + `mfaEnabledAt` dibersihkan, seluruh
  backup code dihapus, dan seluruh refresh token user di-revoke
  (`revokeAllForUser('MFA_DISABLED')`). User harus login ulang.

#### 0.10.5 Error Codes

| Code                         | HTTP | Konteks                                       | UI Copy (ID)                                   |
| ---------------------------- | ---- | --------------------------------------------- | ---------------------------------------------- |
| `MFA_REQUIRED`               | 403  | Pre-MFA token mencoba endpoint biasa          | (auto-redirect ke `/login/mfa`)                |
| `MFA_ENROLLMENT_REQUIRED`    | 403  | HR/SA belum enroll                            | (auto-redirect ke `/setup-mfa`)                |
| `MFA_INVALID_CODE`           | 401  | TOTP salah / backup code habis / spent        | Kode MFA tidak valid.                          |
| `MFA_ALREADY_ENABLED`        | 409  | Enroll ulang tanpa disable                    | MFA sudah aktif. Nonaktifkan terlebih dahulu.  |
| `MFA_ENROLLMENT_NOT_STARTED` | 400  | Confirm tanpa start                           | Mulai enrollment dulu sebelum konfirmasi.      |
| `MFA_NOT_ENABLED`            | 400  | Disable/regenerate saat MFA off               | MFA belum aktif.                               |
| `MFA_MISSING_REFRESH`        | 401  | Verify tanpa cookie refresh                   | Sesi login tidak lengkap. Silakan login ulang. |
| `INVALID_CREDENTIALS`        | 401  | Wrong password on `DELETE /auth/mfa`          | Password tidak sesuai.                         |
| `THROTTLED`                  | 429  | 10/60s IP (verify), 5/60s IP (enroll/disable) | Terlalu banyak percobaan.                      |

#### 0.10.6 Env & Ops

| Env                         | Wajib                     | Default     | Catatan                                    |
| --------------------------- | ------------------------- | ----------- | ------------------------------------------ |
| `MFA_SECRET_ENCRYPTION_KEY` | Prod: ya                  | (kosong)    | Base64 32 byte. `openssl rand -base64 32`  |
| `MFA_ISSUER`                | Tidak                     | `Workpulse` | Muncul di entry authenticator app          |
| `MFA_BACKUP_CODES_COUNT`    | Tidak                     | `8`         | Range 4–20                                 |
| `MFA_ENFORCE_HR_ADMIN`      | Prod: ya (default `true`) | `true`      | `false` DITOLAK saat `NODE_ENV=production` |

Rotasi `MFA_SECRET_ENCRYPTION_KEY`: **hentikan sesi user**, re-enroll
setiap user manual. Tidak ada re-encryption otomatis di Fase 30a
(future ADR — lihat "out of scope" di [ADR-0017](./ADR/ADR-0017-mfa-totp.md)).

### 0.11 Session / Device Management (Fase 30b)

Setiap login menghasilkan satu row `RefreshToken`. Pengguna dapat
melihat dan mencabut sesi aktif dari `/settings/security`.

#### 0.11.1 Kebijakan

- Semua endpoint dibatasi ke `user.id` pemanggil (personal, bukan
  admin surface).
- Admin tetap memakai `POST /admin/users/:id/reset-password` /
  `deactivate` untuk mencabut sesi user lain — sudah teraudit di
  `UserAdminService`.
- Guard stack sama dengan endpoint biasa: `JwtAuthGuard` →
  `MustChangePasswordGuard` → `MfaVerifiedGuard` → `MfaEnrollmentGuard`.
  Token pre-MFA (`mfaPassed=false`) tidak boleh melihat / mencabut
  sesi — mencegah leak setelah pencurian first-factor cookie.

#### 0.11.2 Endpoint

| Method | Path                                  | Deskripsi                                                                                                                                                      |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/auth/sessions`               | List sesi ACTIVE (belum expired). Menandai satu row `isCurrent=true` berdasarkan hash `wp_refresh` cookie.                                                     |
| DELETE | `/api/v1/auth/sessions/:id`           | Cabut satu sesi milik pemanggil. `204` sukses. `404 SESSION_NOT_FOUND` untuk id asing atau tidak ada. `403 SESSION_ALREADY_REVOKED` bila row sudah non-ACTIVE. |
| POST   | `/api/v1/auth/sessions/revoke-others` | Cabut semua sesi ACTIVE KECUALI current. Response `{ revokedCount }`.                                                                                          |

Wire shape `SessionDto`:

```ts
{
  id: string;
  userAgent: string | null;
  ip: string | null;
  mfaVerified: boolean;
  createdAt: string; // ISO
  expiresAt: string; // ISO
  isCurrent: boolean;
}
```

#### 0.11.3 Audit

Setiap perubahan status ditulis ke `AuditLog` dalam
`prisma.$transaction`:

| Action                   | Payload                      | Kapan                             |
| ------------------------ | ---------------------------- | --------------------------------- |
| `SESSION_REVOKED`        | `entityId = RefreshToken.id` | Satu sesi dicabut                 |
| `SESSION_REVOKED_OTHERS` | `afterJson = { count }`      | Bulk revoke (skip bila `count=0`) |

#### 0.11.4 Rate limit

Per-caller (throttler default):

- `DELETE /auth/sessions/:id` — 30 request / 60s
- `POST /auth/sessions/revoke-others` — 10 request / 60s

#### 0.11.5 UX di `/settings/security`

- Kolom "Sesi ini" ditandai lewat `isCurrent` — badge biru.
- Row menampilkan label perangkat (heuristik UA: Chrome/Firefox/Safari
  × Windows/macOS/…), IP, badge MFA (jika `mfaVerified=true`), dan
  timestamp login + kedaluwarsa.
- Cabut sesi sendiri (isCurrent) → FE clear `authStore` +
  `window.location.assign('/login')` (cookie sudah mati, `/refresh`
  akan 401).
- Cabut sesi lain → toast "N sesi lain berhasil dinonaktifkan" via
  `revokedCount`.

### 0.12 Email Transport & Security Headers (Fase 30c)

Fase 30c menutup dua celah operasional: pengiriman email nyata dan
audit security headers.

#### 0.12.1 Email transport

`EmailAdapter` sekarang punya 3 implementasi konkret, dipilih runtime
lewat `EMAIL_TRANSPORT`:

| Value      | Adapter                         | Kapan dipakai                                                                 |
| ---------- | ------------------------------- | ----------------------------------------------------------------------------- |
| `console`  | `ConsoleEmailAdapter`           | Dev, seed demo, log-only                                                      |
| `disabled` | `DisabledEmailAdapter`          | Isolated E2E (tidak ada log noise)                                            |
| `smtp`     | `SmtpEmailAdapter` (nodemailer) | Production — semua provider (SES, SendGrid, Mailgun, Postmark) mendukung SMTP |

`superRefine` di [`env.validation.ts`](../apps/api/src/config/env.validation.ts)
sekarang **menolak** `NODE_ENV=production` dengan `EMAIL_TRANSPORT ≠ smtp`,
dan menolak `EMAIL_TRANSPORT=smtp` tanpa `SMTP_HOST` / `SMTP_PORT`.

Kontrak kegagalan tetap: `send()` **tidak pernah throw** — kegagalan
provider dilog `WARN` dan dropped. Ini mempertahankan invariant lama
"business transaction MUST commit meskipun email gagal".

Env vars:

| Var                       | Wajib                       | Default                                | Catatan                                                                 |
| ------------------------- | --------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `EMAIL_TRANSPORT`         | Prod: ya (`smtp`)           | `console`                              | Ditolak selain `smtp` di production                                     |
| `EMAIL_FROM`              | Tidak                       | `Workpulse <no-reply@workpulse.local>` | Header `From`                                                           |
| `SMTP_HOST`               | Bila `EMAIL_TRANSPORT=smtp` | —                                      | mis. `email-smtp.us-east-1.amazonaws.com`                               |
| `SMTP_PORT`               | Bila `EMAIL_TRANSPORT=smtp` | —                                      | 587 (STARTTLS) atau 465 (SMTPS)                                         |
| `SMTP_SECURE`             | Tidak                       | `false`                                | `true` untuk port 465                                                   |
| `SMTP_USER` / `SMTP_PASS` | Opsional                    | —                                      | Kosongkan untuk open relay dev                                          |
| `SMTP_VERIFY_ON_BOOT`     | Tidak                       | `false`                                | `true` menjalankan `transporter.verify()` di boot; failure hanya `WARN` |

#### 0.12.2 Security headers

**API (`apps/api/src/main.ts`)** — Helmet dituning:

- `Content-Security-Policy`: `default-src 'self'`, `frame-ancestors 'none'`,
  `object-src 'none'`. **Tidak ada** `'unsafe-inline'` di `script-src`.
- `X-Frame-Options: DENY` (sebelumnya `SAMEORIGIN`).
- `Referrer-Policy: no-referrer`.
- `Strict-Transport-Security` hanya di production. `HSTS_PRELOAD=true`
  → `max-age=63072000; includeSubDomains; preload` (irreversible —
  hanya nyalakan setelah semua subdomain punya HTTPS valid).

**Web (`apps/web`)** — dua lapis:

1. `middleware.ts` — CSP per-request dengan **nonce 128-bit baru
   setiap request**. `script-src 'nonce-<base64>' 'strict-dynamic'`
   membuat Next.js bootstrap script boleh hydrate sementara semua
   inline script lain diblok. Dev tambahkan `'unsafe-eval'` untuk
   HMR runtime.
2. `next.config.mjs → headers()` — static headers untuk semua route
   (termasuk `/_next/*`): `X-Frame-Options: DENY`,
   `Referrer-Policy: no-referrer`,
   `Permissions-Policy` (camera/mic/usb/… ditolak; `geolocation=(self)`
   tetap boleh untuk clock-in), `HSTS` di production.

Env vars baru:

| Var                     | Wajib | Default  | Catatan                                                                                                  |
| ----------------------- | ----- | -------- | -------------------------------------------------------------------------------------------------------- |
| `API_CSP_EXTRA_ORIGINS` | Tidak | (kosong) | Extra origins untuk `connect-src` / `img-src` di API CSP. Comma-separated                                |
| `HSTS_PRELOAD`          | Tidak | `false`  | Aktifkan hanya bila semua subdomain HTTPS valid — masuk browser preload list = commitment jangka panjang |

### 0.13 Data Subject Access Request / DSAR (Fase 31a)

Fase 31a memperkenalkan hak portabilitas data untuk seluruh user
(sesuai UU PDP dan GDPR Art. 15). User dapat mengunduh salinan
seluruh data pribadinya sebagai satu berkas ZIP.

Detail arsitektur ada di
[docs/ADR/ADR-0020-data-export-dsar.md](ADR/ADR-0020-data-export-dsar.md).
Ringkasan di sini fokus pada kebijakan yang diperhatikan tim HR / Ops.

#### 0.13.1 Alur permintaan

```
User → /settings/privacy → klik "Ajukan ekspor data"
    ↓
POST /api/v1/me/data-export
    ├── 409 EXPORT_ALREADY_PENDING  (permintaan berjalan)
    ├── 409 EXPORT_COOLDOWN         (24 jam terakhir sudah request)
    └── 201 Created                 (PENDING row + audit)
    ↓
DataExportWorker cron (setiap 30 detik)
    ├── SELECT ... FOR UPDATE SKIP LOCKED  → PENDING → PROCESSING
    ├── assembleExportArchive              → ZIP di memory
    ├── storage.putObject(key, body)       → data-exports/{co}/{user}/{req}.zip
    └── READY + fileSize + expiresAt (now + 24h)
    ↓
User → klik "Unduh" → GET /me/data-export/:id/download
    ↓
Fresh presigned S3 URL (TTL = S3_PRESIGN_GET_TTL_SECONDS)
    ↓
Browser mengunduh langsung dari S3
```

Retention sweep berjalan harian 03:15 UTC: setiap row `READY` yang
melampaui `expiresAt` akan dibalik ke `EXPIRED`, S3 object dihapus,
dan audit `DATA_EXPORT_EXPIRED` ditulis.

#### 0.13.2 Kebijakan

- **Rate limit bisnis**: 1 permintaan per user per 24 jam (via
  `DATA_EXPORT_COOLDOWN_HOURS`). Layer throttler tambahan: 5
  percobaan `POST` per jam (menahan noise audit).
- **Isi arsip**: profile, company, department, shift assignment,
  attendance + event + koreksi, absensi, leave (balance + request),
  overtime, notification (+ preference), session metadata, audit log
  (max 5.000 entri per user, dari yang terbaru), serta manifest
  redaksi.
- **Yang tidak disertakan**: `passwordHash`, `mfaSecret`,
  `refreshToken.tokenHash`, `mfaBackupCode.codeHash`,
  `passwordResetToken.tokenHash`. Daftar redaksi eksplisit ditulis
  di file `security.json` + `README.txt` dalam arsip.
- **Retensi arsip**: 24 jam sejak `completedAt`. Lewat itu, S3
  object dihapus dan URL unduh berhenti berfungsi.
- **Presigned URL**: TTL mengikuti `S3_PRESIGN_GET_TTL_SECONDS`
  (default 1 jam). URL tidak pernah disimpan di FE state atau
  history — dimint ulang setiap klik.

#### 0.13.3 Error codes (FE copy)

| Code                     | HTTP | UI Copy (ID)                                                                          |
| ------------------------ | ---- | ------------------------------------------------------------------------------------- |
| `EXPORT_ALREADY_PENDING` | 409  | Permintaan ekspor sudah berjalan. Tunggu sampai selesai sebelum mengajukan yang baru. |
| `EXPORT_COOLDOWN`        | 409  | Permintaan ekspor hanya bisa dilakukan sekali per 24 jam.                             |
| `EXPORT_NOT_READY`       | 409  | Arsip masih diproses. Coba lagi sebentar.                                             |
| `EXPORT_FAILED`          | 409  | Pembuatan arsip sebelumnya gagal. Silakan ajukan ulang.                               |
| `EXPORT_EXPIRED`         | 410  | Arsip sudah kedaluwarsa (batas 24 jam terlewat). Silakan ajukan permintaan baru.      |
| `EXPORT_NOT_FOUND`       | 404  | Permintaan ekspor tidak ditemukan.                                                    |

#### 0.13.4 Audit trail

Setiap transisi mencatat baris di `AuditLog` (immutable):

- `DATA_EXPORT_REQUESTED` — user klik "Ajukan ekspor".
- `DATA_EXPORT_COMPLETED` — worker sukses upload ke S3.
- `DATA_EXPORT_FAILED` — worker menyerah setelah error.
- `DATA_EXPORT_DOWNLOAD_URL_ISSUED` — user meminta presigned URL.
- `DATA_EXPORT_EXPIRED` — retention sweep menghapus arsip.

#### 0.13.5 Ops env vars

| Env                          | Wajib | Default | Catatan                                                     |
| ---------------------------- | ----- | ------- | ----------------------------------------------------------- |
| `DATA_EXPORT_COOLDOWN_HOURS` | Tidak | `24`    | Cooldown user-side. Range 1–168 jam.                        |
| `DATA_EXPORT_WORKER_ENABLED` | Tidak | `true`  | Set `false` untuk memindahkan pemrosesan ke node dedicated. |

### 0.14 Right to Erasure (Fase 31b)

Melengkapi DSAR (0.13) dengan hak untuk "dilupakan" sesuai UU PDP
Pasal 27 dan GDPR Art. 17. Bedanya dengan hard delete: **record
bisnis (kehadiran, cuti, lembur, audit) TETAP disimpan** untuk
memenuhi kewajiban retensi UU Ketenagakerjaan + pajak (7–10 tahun).
Yang dihapus/dianonimkan hanyalah data pribadi + kredensial.

Detail arsitektur ada di
[docs/ADR/ADR-0021-right-to-erasure.md](ADR/ADR-0021-right-to-erasure.md).

#### 0.14.1 State machine

```
PENDING_APPROVAL ─(approve oleh HR/Admin)─► APPROVED_SCHEDULED
      │                                             │
      │(reject dengan catatan wajib)                │(user cancel)
      ▼                                             ▼
    REJECTED                                    CANCELLED
                                                    │
                                                    │(worker setelah `scheduledFor`)
                                                    ▼
                                              EXECUTED (atau FAILED)
```

Grace period default 7 hari (`DATA_ERASURE_GRACE_DAYS`, range 1–30).
Approver = **HR_MANAGER ATAU SUPER_ADMIN** — salah satu cukup. Self
approval ditolak (`ERASURE_SELF_APPROVAL`).

#### 0.14.2 Endpoints self-service

| Method | Path                                 | Efek                                  |
| ------ | ------------------------------------ | ------------------------------------- |
| POST   | `/api/v1/me/data-erasure`            | Buat request. 409 jika ada in-flight. |
| GET    | `/api/v1/me/data-erasure`            | 25 request terakhir milik user.       |
| POST   | `/api/v1/me/data-erasure/:id/cancel` | Cancel selama PENDING/SCHEDULED.      |

#### 0.14.3 Endpoints admin (HR_MANAGER + SUPER_ADMIN)

| Method | Path                                     | Efek                           |
| ------ | ---------------------------------------- | ------------------------------ |
| GET    | `/api/v1/admin/data-erasure/pending`     | Queue (PENDING + SCHEDULED).   |
| GET    | `/api/v1/admin/data-erasure`             | Full history (100 terakhir).   |
| POST   | `/api/v1/admin/data-erasure/:id/approve` | Note opsional.                 |
| POST   | `/api/v1/admin/data-erasure/:id/reject`  | Note WAJIB (400 kalau kosong). |

#### 0.14.4 Anonimisasi (yang berubah)

- `User.email` → `erased-<userId>@workpulse.deleted`
- `User.fullName` → `Erased User`
- `User.passwordHash` → 64 byte random hex (tidak bisa login)
- `User.mfaSecret`, `mfaEnabledAt` → NULL
- `User.employmentStatus` → TERMINATED, `deletedAt` = now
- `MfaBackupCode`, `PasswordResetToken`, `NotificationPreference`,
  `Notification` (untuk user) → DIHAPUS
- `RefreshToken` semua → REVOKED
- `DataExportRequest` yang masih hidup → EXPIRED + fileKey NULL
  (S3 dihapus best-effort di luar transaction)

Record bisnis (attendance, leave, overtime, correction, audit) tidak
disentuh.

#### 0.14.5 Audit events

- `DATA_ERASURE_REQUESTED`
- `DATA_ERASURE_APPROVED`
- `DATA_ERASURE_REJECTED`
- `DATA_ERASURE_CANCELLED`
- `DATA_ERASURE_EXECUTED`
- `DATA_ERASURE_FAILED`

#### 0.14.6 Ops env vars

| Env                           | Wajib | Default | Catatan             |
| ----------------------------- | ----- | ------- | ------------------- |
| `DATA_ERASURE_GRACE_DAYS`     | Tidak | `7`     | Range 1–30.         |
| `DATA_ERASURE_WORKER_ENABLED` | Tidak | `true`  | Kill switch worker. |

### 0.15 Retention automation + Consent tracking (Fase 31c)

Fase 31c melengkapi Fase 31a/31b dengan **retention otomatis
per-tenant** dan **pencatatan persetujuan kebijakan privasi
berversi**. Detail arsitektur di ADR-0022.

#### 0.15.1 Retention policy per tenant

Setiap Company memiliki satu baris `RetentionPolicy` (dibuat lazily
saat pertama kali dibaca) dengan tiga field integer:

| Field                             | Range  | Default | Semantik `0`         |
| --------------------------------- | ------ | ------- | -------------------- |
| `notificationRetentionDays`       | 0–730  | 90      | Simpan selamanya     |
| `dataExportArchiveRetentionHours` | 1–168  | 24      | —                    |
| `terminatedUserAnonymizeDays`     | 0–3650 | 0       | Auto-anonimisasi off |

Admin (HR_MANAGER / SUPER_ADMIN) mengelola via:

- `GET /admin/privacy/retention` — baca konfigurasi aktif.
- `PUT /admin/privacy/retention` — update sebagian / semua field.
  Nilai di luar range → `400 RETENTION_OUT_OF_BOUNDS`.

Setiap update mencatat `RETENTION_POLICY_UPDATED` di `AuditLog`.

#### 0.15.2 Retention worker (`@Cron('0 0 2 * * *')`)

Setiap hari jam 02:00 UTC worker:

1. **Prune notifikasi** — hapus `Notification` yang lebih tua dari
   `notificationRetentionDays`. Skip bila nilai `0`.
2. **Auto-anonimisasi user berhenti bekerja** — user dengan
   `employmentStatus=TERMINATED` yang `deletedAt` lebih tua dari
   `terminatedUserAnonymizeDays` diproses lewat helper
   `anonymizeUser` (semantik identik dengan Fase 31b: PII
   dihapus, record bisnis tetap disimpan sebagai anchor).

Kill switch: `RETENTION_WORKER_ENABLED=false` di node follower.

#### 0.15.3 Consent tracking

`PrivacyPolicy` — versi kebijakan per tenant. Konstrain unik
`(companyId, version)`. Versi "aktif" = baris dengan `effectiveAt
<= NOW()` terbaru.

`UserConsent` — ledger append-only dengan `@@unique(userId,
policyId)`. Mencatat `ip` + `userAgent` saat penerimaan sebagai
bukti hukum.

Alur:

1. HR / Admin publish versi baru via `POST
/admin/privacy/policies` (form UI di `/admin/privacy/policies`).
2. Backend menandai versi tersebut sebagai `pendingConsent`
   untuk setiap user yang belum menerimanya (surface di
   `GET /auth/me`).
3. FE `RequireAuth` mendeteksi `pendingConsent != null` dan
   force-route ke `/consent`.
4. `ConsentAcceptedGuard` menolak setiap route lain dengan
   `403 CONSENT_REQUIRED` sampai user menerima.
5. User klik "Terima & lanjutkan" → `POST /me/consent` →
   `pendingConsent` bernilai `null` pada request berikutnya.

Riwayat penerimaan user tersedia di `/settings/privacy` (panel
"Persetujuan kebijakan privasi") dan `GET /me/consent/history`.

#### 0.15.4 Guard order

`app.module.ts` menyusun global guards sbb:

```
JwtAuthGuard
  → MustChangePasswordGuard
  → MfaVerifiedGuard
  → MfaEnrollmentGuard
  → ConsentAcceptedGuard   // Fase 31c
  → RolesGuard
```

Route yang di-tag `@AllowMustChangePassword()` atau
`@AllowPendingConsent()` diperbolehkan menembus guard yang
bersangkutan. Sisanya diblokir.

#### 0.15.5 Error codes

| Code                       | HTTP | UI Copy (ID)                                                         |
| -------------------------- | ---- | -------------------------------------------------------------------- |
| `CONSENT_REQUIRED`         | 403  | "Anda perlu menerima kebijakan privasi terbaru sebelum melanjutkan." |
| `POLICY_NOT_FOUND`         | 404  | "Kebijakan privasi tidak ditemukan."                                 |
| `POLICY_NOT_YET_EFFECTIVE` | 409  | "Kebijakan ini belum berlaku."                                       |
| `CONSENT_ALREADY_ACCEPTED` | 409  | "Anda sudah menerima kebijakan ini."                                 |
| `POLICY_VERSION_DUPLICATE` | 409  | "Versi X sudah pernah diterbitkan."                                  |
| `RETENTION_OUT_OF_BOUNDS`  | 400  | "Salah satu nilai berada di luar batas yang diizinkan."              |

#### 0.15.6 Audit trail

Baris baru di `AuditLog`:

- `RETENTION_POLICY_UPDATED` — HR mengubah konfigurasi.
- `RETENTION_NOTIFICATIONS_PRUNED` — worker menghapus batch
  notifikasi (jumlah + retentionDays di `afterJson`).
- `RETENTION_USER_AUTO_ANONYMIZED` — worker menganonimisasi user
  yang sudah TERMINATED cukup lama.
- `POLICY_PUBLISHED` — versi kebijakan diterbitkan.
- `CONSENT_ACCEPTED` — user menerima suatu versi.

`AuditLog.actorId` sekarang nullable — retention sweep dan cron
lainnya menulis dengan `actorId=NULL` (dirender sebagai "System"
di UI audit).

#### 0.15.7 Ops env vars

| Env                        | Wajib | Default | Catatan                     |
| -------------------------- | ----- | ------- | --------------------------- |
| `RETENTION_WORKER_ENABLED` | Tidak | `true`  | Kill switch worker retensi. |

## 1. Kehadiran (Attendance)

### 1.1 Clock-In

```
User (mobile browser)
  ↓ getCurrentPosition (browser Geolocation API)
  ↓ POST /api/v1/attendance/clock-in { latitude, longitude, accuracyMeters, note? }
  ↓
JwtAuthGuard → RolesGuard(EMPLOYEE,SUPERVISOR,HR_MANAGER)
  ↓
AttendanceService.clockIn(user, dto)
  ├── Cari UserShiftAssignment aktif
  ├── Validasi tenant (shift.companyId === user.companyId)  → 403 FORBIDDEN
  ├── checkGeofence(dto, shift.geofence)                    → 403 OUTSIDE_GEOFENCE
  ├── Cek AttendanceRecord existing hari ini                → 409 ALREADY_CLOCKED_IN
  ├── evaluateClockIn (ON_TIME vs LATE dgn grace)
  └── prisma.$transaction:
        • create AttendanceRecord
        • create AttendanceEvent(CLOCK_IN)
        • create AuditLog(ATTENDANCE_CLOCK_IN)
  ↓
201 Created → AttendanceRecordDto
```

Error codes (surfaced ke UI copy di `apps/web/components/features/attendance/clock-panel.tsx`):

| Code                 | HTTP | UI Copy (ID)                         |
| -------------------- | ---- | ------------------------------------ |
| `OUTSIDE_GEOFENCE`   | 403  | Lokasi Anda di luar area kantor.     |
| `ALREADY_CLOCKED_IN` | 409  | Anda sudah clock-in untuk hari ini.  |
| `SHIFT_NOT_FOUND`    | 404  | Shift Anda belum diatur. Hubungi HR. |

### 1.2 Clock-Out

Mirroring clock-in, ditambah:

- Cek `AttendanceRecord.clockOutAt === null` → 409 jika sudah clock-out.
- `evaluateClockOut` menghitung `earlyLeaveMinutes`.
- Update status: menjadi `EARLY_LEAVE` bila leaves before shift end; jika tidak, mempertahankan status clock-in.

### 1.3 Late / Early Leave

Dihitung server-side di `domain/shift-timing.ts` menggunakan timezone
perusahaan. **Tidak pernah** dihitung di klien — device time bisa dimanipulasi.

**Rumus** (semua di UTC millis untuk menghindari DST edge cases):

```
shiftStartUtc = shiftBoundaryToUtc(workDate, shift.startTime, company.timezone)
lateDeltaMs   = clockInAt.getTime() - (shiftStartUtc + shift.graceMinutes * 60_000)

lateMinutes   = lateDeltaMs > 0 ? Math.ceil(lateDeltaMs / 60_000) : 0
status        = lateMinutes > 0 ? LATE : ON_TIME
```

Simetris untuk clock-out (`earlyLeaveMinutes`). Grace period **hanya berlaku
untuk clock-in** — pulang cepat tidak mendapat toleransi (pulang 1 menit
sebelum shift-end tetap `earlyLeaveMinutes = 1`).

**Contoh** (Jakarta, shift 09:00 → 18:00, grace 15 menit):

| Clock-in local | Clock-out local | `lateMinutes` | `earlyLeaveMinutes` | `status`                                         |
| -------------- | --------------- | ------------- | ------------------- | ------------------------------------------------ |
| 08:55          | 18:00           | 0             | 0                   | ON_TIME                                          |
| 09:14          | 18:00           | 0             | 0                   | ON_TIME                                          |
| 09:16          | 18:00           | 1             | 0                   | LATE                                             |
| 09:45          | 17:30           | 30            | 30                  | LATE (lalu update ke EARLY_LEAVE saat clock-out) |
| 09:00          | 17:00           | 0             | 60                  | EARLY_LEAVE                                      |

### 1.4 Riwayat & Rekap Self-Service

| Endpoint                                          | Deskripsi                                          |
| ------------------------------------------------- | -------------------------------------------------- |
| `GET /api/v1/attendance/me/today`                 | Baris hari ini (null jika belum clock-in)          |
| `GET /api/v1/attendance/me/history?from&to&limit` | Riwayat caller (max 366 hari, max 200 rows)        |
| `GET /api/v1/attendance/me/summary?year&month`    | Rekap bulanan (present, on-time, late, early, jam) |

Rekap bulanan diproduksi oleh fungsi pure `summarizeAttendance` di
`attendance/domain/attendance-summary.ts`. Rule:

- `ABSENT` dan `ON_LEAVE` **tidak** dihitung `presentDays` maupun jam kerja.
- Baris dengan `lateMinutes > 0` **DAN** `earlyLeaveMinutes > 0` menaikkan
  dua counter (masuk `lateDays` + `earlyLeaveDays`), **tidak** masuk
  `onTimeDays` — indikator disiplin harus konservatif.
- `onTimeRatePercent = onTimeDays / presentDays` (1 desimal), `null` jika
  bulan kosong (bukan `0` untuk menghindari false negative).

UI: card `MonthlySummaryWidget` (4 stat tile + progress bar) di
`/attendance`; tabel penuh di `/attendance/history`.

### 1.5 Supervisor / HR — Team View

Supervisor dan HR punya visibilitas kolektif terhadap tim mereka. Employee
**tidak** memiliki akses ke endpoint ini (403 FORBIDDEN).

| Endpoint                                            | Deskripsi                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /api/v1/attendance/team/today?date=YYYY-MM-DD` | Roster + status clock-in hari tsb (default: hari ini)             |
| `GET /api/v1/attendance/team/summary?from&to`       | Rekap per-anggota, rentang max 92 hari (default: 7 hari terakhir) |

**Scoping (server-side, di `AttendanceService.loadRoster`):**

| Role          | Roster                                                 |
| ------------- | ------------------------------------------------------ |
| `SUPERVISOR`  | Users dengan `supervisorId = actor.id`                 |
| `HR_MANAGER`  | Seluruh users di tenant (kecuali SUSPENDED/TERMINATED) |
| `SUPER_ADMIN` | Seluruh users di tenant (kecuali SUSPENDED/TERMINATED) |
| `EMPLOYEE`    | 403 FORBIDDEN                                          |

**Semantics — Team Today:**

- Roster **selalu** lengkap: anggota tim yang belum clock-in tetap muncul
  dengan `status = NOT_CLOCKED_IN` (bukan `ABSENT`, karena `ABSENT` di
  Workpulse adalah decision HR/cron eksplisit — dokumen ADR-0007).
- Baris di-sort berdasarkan **severity exception**: `LATE` → `EARLY_LEAVE`
  → `NOT_CLOCKED_IN` → `ABSENT` → `ON_LEAVE` → `ON_TIME` (supervisor
  langsung lihat masalah di atas).
- Tie-break: nama alfabetis lokal ID.

**Semantics — Team Summary:**

- Sama seperti self-summary (§1.4) tapi disebarkan per user.
- Sort: worst on-time rate first, tie-break `lateDays` desc, kemudian nama.
- `null` on-time rate (user tanpa clock-in di rentang) di-treat sebagai
  100%+1 di sort → paling bawah (dianggap "clean" bucket walau data absen).
- Rentang max **92 hari** (rasional: coverage kuartal; ROI tambahan setelah
  itu tipis — HR yang butuh trend tahunan pakai Reports module).

**UI (frontend):**

- Halaman `/attendance/team` (role-gated, link muncul di `/attendance` bagi
  supervisor+).
- Toggle antara "Hari ini" (default) dan "Rekap".
- Date picker untuk retrospective view (max hari ini).
- Preset range 7 / 14 / 30 hari untuk summary.
- Auto-refetch 60 detik di tab "Hari ini" agar roster terupdate saat orang
  clock-in bertahap.

### 1.6 Auto-Absent Scheduler

**Tujuan:** Setiap hari kerja yang berlalu tanpa clock-in dan tanpa
approved leave DIMATERIALKAN sebagai baris `AbsenceRecord` — canonical
"user tidak hadir pada tanggal X". Diperlukan agar (a) monthly summary
memiliki `absentDays > 0` tanpa perlu roster join per query, (b) HR
punya trail audit untuk pemotongan payroll, (c) notifikasi tepat waktu
mengingatkan karyawan + supervisor agar bisa dispute jika keliru.

**Provenance (kolom `AbsenceRecord.source`):**

| Enum             | Kapan diset                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `AUTO_SCHEDULER` | Cron menandai (default). `markedById` selalu NULL. `reason` selalu NULL.                                |
| `MANUAL_HR`      | HR/Super Admin mem-POST `/attendance/absence`. `markedById = actor.id`, `reason` opsional (audit note). |

**Domain rules (per `classifyAbsence`):**

Klasifikasi ABSENT dijalankan HANYA jika seluruh guard di bawah lolos
(urutan short-circuit dipilih agar `SKIP.reason` selalu paling informatif):

1. `employmentStatus ∈ {TERMINATED, SUSPENDED}` → SKIP `INACTIVE`.
2. `hiredAt > targetDate` → SKIP `NOT_HIRED_YET`.
3. Sabtu / Minggu → SKIP `WEEKEND` (weekend policy MVP: Sat+Sun; kelak
   bisa per-shift `workingDays[]`).
4. `Holiday` untuk tenant ada di tanggal → SKIP `HOLIDAY`.
5. Tidak ada `UserShiftAssignment` yang mencakup tanggal → SKIP
   `NO_SHIFT_ASSIGNMENT` (user memang tidak dijadwalkan).
6. `AttendanceRecord` existent → SKIP `CLOCKED_IN`.
7. `LeaveRequest` APPROVED yang mencakup tanggal → SKIP `ON_APPROVED_LEAVE`.
8. `AbsenceRecord` sudah ada → SKIP `ALREADY_MARKED` (idempoten).
9. Semua lolos → **ABSENT** (`AbsenceRecord` diinsert + notif dikirim).

**Cadence:** cron `@Cron(EVERY_HOUR)` di `AttendanceSchedulerService`.
Tiap jam iterasi seluruh Company. Untuk masing-masing:

- `resolveTargetDate(now, timezone, absentScanGraceHours)` — Return
  ISO tanggal "yesterday-in-tenant-tz" bila kita sudah >
  `absentScanGraceHours` jam lewat tengah malam tenant. Bila belum
  (misalnya 05:00 di Jakarta dengan grace=6h), return `null` → skip.
- `pendingScanDates(target, lastScanned, MAX_BACKFILL_DAYS=30)` — Hitung
  tanggal-tanggal yang belum diproses (backfill bila cron sempat mati
  beberapa hari; cap 30 hari agar loop tidak stuck di tenant lama).
- Untuk setiap tanggal jalankan `scanCompanyForDate()`, lalu majukan
  cursor `Company.lastAbsentScanDate` ke tanggal terakhir sukses.

**Idempotency guarantees:**

- Unique `(userId, workDate)` di `AbsenceRecord` → race antara dua
  scheduler instance → yang kalah dapat P2002 dan dicount sebagai
  `ALREADY_MARKED` skip (bukan error).
- Notifikasi dikirim SETELAH insert sukses; kegagalan notif ter-log
  tetapi TIDAK rollback klasifikasi (classification adalah source of
  truth, notif hanya delivery).
- Cursor `lastAbsentScanDate` hanya maju setelah tanggal sukses
  sepenuhnya diproses. Bila tanggal N gagal, tanggal N+1..M
  dibatalkan → retry di tick berikutnya.

**Notifikasi (`ATTENDANCE_ABSENT_MARKED`):**

Setiap klasifikasi ABSENT memicu 1 atau 2 notifikasi (in-app + email
best-effort):

1. Untuk **employee** — nada halus ("Silakan hubungi HR jika keliru"),
   deep-link ke `/attendance/history`.
2. Untuk **direct supervisor** (bila `User.supervisorId` non-null) —
   deep-link ke `/attendance/team?date=YYYY-MM-DD` agar supervisor bisa
   langsung koordinasi.

**Config per-tenant:**

- `Company.absentScanGraceHours` — default 6. Buffer sebelum tanggal
  yang baru berlalu dianggap "sudah aman" untuk diklasifikasi. Naikkan
  jika tenant sering ada late-timesheet-correction; turunkan bila HR
  ingin data segera terlihat.
- `Company.lastAbsentScanDate` — cursor internal (jangan diedit manual
  kecuali dalam skenario recovery yang direncanakan).

**Manual trigger endpoint:**

`POST /api/v1/attendance/scanner/run` (SUPER_ADMIN only, HTTP 202,
throttled) — memaksa run sekarang. Kombinasi useful untuk "HR baru
tambah holiday retroaktif, mau re-classify tanpa nunggu tick berikutnya"
(hapus dulu `AbsenceRecord` yang keliru → run manual → dapat ulang).

**Reset cursor endpoint (ADR-0010 follow-up):**

`POST /api/v1/attendance/scanner/reset-cursor` (SUPER_ADMIN only,
HTTP 200) — meng-null-kan `Company.lastAbsentScanDate` untuk tenant
pemanggil dan opsional langsung menjalankan scan ulang tenant tersebut.

- **Body:** `{ "triggerRescan"?: boolean }` (default `false`).
- **Response:** `{ before, after: null, rescanTriggered, rescanResult? }`.
  Field `rescanResult` hanya muncul saat `triggerRescan=true` dan berisi
  slice per-tenant identik dengan `runAll`.
- **Blast radius:** clearing cursor bikin next run backfill hingga
  `MAX_BACKFILL_DAYS` (30) hari ke belakang. `AbsenceRecord` idempotent
  di `(userId, workDate)`, tapi **notifikasi tidak di-dedupe** — user
  yang datanya baru diklasifikasi akan menerima
  `ATTENDANCE_ABSENT_MARKED` lagi. Konfirmasi ke tim ops sebelum
  memicu.
- **Payroll cutoff tetap berlaku.** Tanggal ≤ cutoff tetap di-skip
  dengan `PAYROLL_LOCKED` (aturan ADR-0010 tidak bypass).
- **Cross-tenant:** endpoint mengambil `companyId` dari `actor` — SUPER
  ADMIN tidak bisa reset tenant lain lewat endpoint ini. Eskalasi
  cross-tenant: SQL manual + audit log by hand.
- **Audit:** menulis satu entry `SCANNER_CURSOR_RESET` di `AuditLog`
  dengan `beforeJson={lastAbsentScanDate}`, `afterJson={lastAbsentScanDate:null,triggerRescan}`.

Kapan pakai:

- HR baru menambahkan holiday retroaktif untuk periode yang sudah
  di-skip cursor → reset agar tanggal-tanggal tersebut di-classify
  ulang.
- Shift assignment di-backdate untuk periode masa lalu → tanggal yang
  dulu `NO_SHIFT_ASSIGNMENT` sekarang harus dikaji ulang.
- Cursor drift setelah recovery / restore database ke titik yang lebih
  lama dari `lastAbsentScanDate`.

**Manual HR override endpoints:**

Skenario: karyawan lupa filekan cuti, atau HR mau menetapkan status
absen retroaktif sebelum periode scanner aktif (mis. onboarding data
legacy). Skenario sebaliknya: scheduler keliru menandai absen karena
data cuti telat masuk — HR harus bisa mencabutnya.

| Endpoint                         | Role                        | Semantik                                                                                                                     |
| -------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST /attendance/absence`       | `HR_MANAGER`, `SUPER_ADMIN` | Buat `AbsenceRecord` dengan `source=MANUAL_HR`, `markedById=actor.id`. Body: `{ userId, workDate, reason? }` (reason ≤500).  |
| `DELETE /attendance/absence/:id` | `HR_MANAGER`, `SUPER_ADMIN` | Hard-delete satu `AbsenceRecord` (baik AUTO maupun MANUAL). Audit log `ATTENDANCE_UNMARK_ABSENT` menyimpan snapshot sebelum. |

Invariant yang di-enforce di service layer (`AttendanceService.markAbsent`):

1. **Tenant isolation.** `userId` harus milik company `actor`. Cross-tenant
   → 404 (tidak membocorkan eksistensi id di tenant lain).
2. **Tidak boleh masa depan.** `workDate > today (UTC)` → 400 `DATE_IN_FUTURE`.
3. **Tidak sebelum hire.** `workDate < user.hiredAt` → 400 `NOT_HIRED_YET`.
4. **Tidak menabrak clock-in.** Jika `AttendanceRecord` sudah ada untuk
   `(user, date)` → 409 `CLOCKED_IN` (HR harus hapus record itu dulu
   lewat flow lain — mencegah clobbering clock data).
5. **Tidak dobel.** Jika `AbsenceRecord` sudah ada (AUTO atau MANUAL)
   untuk `(user, date)` → 409 `ALREADY_MARKED`. Pola idempoten: hapus →
   buat ulang bila HR ingin ganti reason/source.

Sukses memicu fanout notifikasi yang **identik** dengan auto-scheduler
(`ATTENDANCE_ABSENT_MARKED`): employee + supervisor dapat notifikasi
in-app + email best-effort. Ini disengaja — dari sisi karyawan tidak
ada bedanya "cron menandai" vs "HR menandai", yang penting mereka tahu.

Audit trail: setiap create menulis `AuditLog(action='ATTENDANCE_MARK_ABSENT')`
dengan `afterJson={ userId, workDate, source, reason }`; setiap delete
menulis `AuditLog(action='ATTENDANCE_UNMARK_ABSENT')` dengan
`beforeJson={ userId, workDate, source }`. Best-effort — kegagalan
audit di-log tapi TIDAK rollback aksi utama (audit reliability adalah
concern operator, bukan alasan blok payroll adjustment).

**Team roster metadata:**

`TeamMemberDailyRow` sekarang membawa dua field ekstra ketika `status=ABSENT`:

- `absenceRecordId: string | null` — id `AbsenceRecord`. FE HR pakai
  untuk `DELETE /attendance/absence/:id`. Null untuk baris non-absent.
- `absenceSource: 'AUTO_SCHEDULER' | 'MANUAL_HR' | null` — provenance,
  ditampilkan sebagai pill kecil di UI ("Otomatis" vs "HR") agar HR
  bisa membedakan sekilas.

Bila HR yang mendorong `AttendanceRecord` yang tidak konsisten (mis.
clock-in dispute) DAN `AbsenceRecord` co-existent, `AttendanceRecord`
menang di daily view (defensive) tapi `AbsenceRecord` tetap ada di DB
untuk reconciliation.

### 1.7 HR Company-Wide Dashboard

**Endpoint:** `GET /api/v1/attendance/dashboard?date=YYYY-MM-DD` (default
today, UTC). RBAC: `HR_MANAGER`, `SUPER_ADMIN`. Supervisor pakai
`/attendance/team` (lebih sempit ke reports langsung).

**Bucket (mutually exclusive per user):**

Precedence saat klasifikasi status per user (`buildCompanySnapshot`):

```
CLOCKED_IN  →  ABSENT  →  ON_LEAVE  →  NOT_CLOCKED_IN
```

Yaitu bila ada `AttendanceRecord` maka CLOCKED_IN menang bahkan bila
ada `AbsenceRecord` keliru (defensive). ABSENT lebih tinggi dari
ON_LEAVE (kalau HR mencabut approved leave setelah scanner sudah
menandai). NOT_CLOCKED_IN adalah "belum ada signal apa-apa" — biasanya
karyawan yang masih dalam window kerja hari ini.

**Payload:**

```json
{
  "date": "2026-08-05",
  "total": 120, "clockedIn": 100, "absent": 5, "onLeave": 8,
  "notClockedIn": 7, "lateToday": 12, "earlyLeaveToday": 3,
  "onTimeRatePercent": 85.0,
  "departments": [
    { "departmentId": "d1", "departmentName": "Engineering",
      "total": 40, "clockedIn": 38, "absent": 1, "onLeave": 1,
      "notClockedIn": 0, "lateToday": 3, "earlyLeaveToday": 0,
      "onTimeRatePercent": 92.1 },
    ...
  ]
}
```

`onTimeRatePercent = (clockedIn - late - earlyLeave) / clockedIn`,
`null` bila `clockedIn = 0` (avoid /0). Bucket "Tanpa departemen"
otomatis muncul untuk user tanpa `departmentId` — jangan diedit di FE.

**UI (frontend):**

- Halaman `/attendance/dashboard` (role-gated, link muncul di
  `/attendance` bagi HR+).
- Auto-refresh setiap 60 detik + refetch on focus.
- Date picker untuk retrospective (tidak dibatasi tanggal max
  sisi FE — server menerima tanggal mana pun).
- Tabel per departemen sorted by exception-count desc (department
  paling problematik naik ke atas).

### 1.8 Payroll Cutoff (Frozen Period)

**Tujuan:** Setelah HR / payroll menutup periode gaji (mis. akhir
bulan), data yang mempengaruhi paycheck di periode tersebut TIDAK
boleh berubah lagi — absensi, cuti disetujui, ataupun lembur
disetujui / diselesaikan. Kalau tidak, mutasi post-payroll akan
menciptakan diskrepansi antara DB dan paycheck yang sudah
ditransfer.

**Kolom:** `Company.payrollLockedUntil DATE NULL` (inklusif).
Contoh: `2026-07-31` → seluruh Juli beku, klasifikasi absen 2026-08-01
bebas dimutasi.

**Helper domain:** `apps/api/src/common/domain/payroll-lock.ts`
menyediakan `assertPayrollNotLocked(targetDate, cutoff, {role})`
yang di-reuse oleh Attendance, Leave, dan Overtime module. SUPER_ADMIN
bypass di-encode di dalam helper (bukan di per-caller) supaya semantik
konsisten lintas modul.

**Yang di-enforce (attendance):**

| Aksi                                         | Locked (workDate ≤ cutoff)                             |
| -------------------------------------------- | ------------------------------------------------------ |
| `POST /attendance/absence` (HR mark)         | **409 CONFLICT** — `code: PAYROLL_LOCKED`              |
| `DELETE /attendance/absence/:id` (HR unmark) | **409 CONFLICT** — `code: PAYROLL_LOCKED`              |
| Auto-absent scheduler                        | SKIP dengan reason `PAYROLL_LOCKED` (per-date counter) |
| Aksi yang sama dengan role `SUPER_ADMIN`     | **Diperbolehkan** (emergency-override lane)            |

**Yang di-enforce (leave — startDate sebagai anchor):**

| Aksi                                          | `LeaveRequest.startDate ≤ cutoff`                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `POST /leave` (submit)                        | **409 CONFLICT** — `code: PAYROLL_LOCKED`                                                  |
| `POST /leave/:id/decision` (approve / reject) | **409 CONFLICT** — `code: PAYROLL_LOCKED`                                                  |
| `POST /leave/:id/cancel` (owner batalkan)     | **409 CONFLICT** — `code: PAYROLL_LOCKED`                                                  |
| SUPER_ADMIN pada aksi decide / (edge) cancel  | **Diperbolehkan** (submit tetap tertutup: SUPER_ADMIN tidak ada di `@Roles` `POST /leave`) |

Kenapa hanya `startDate`? Range yang overlap cutoff di sisinya (mis.
cuti 25-Jul → 05-Aug dengan cutoff 31-Jul) TIDAK bisa "sebagian beku":
begitu range menyentuh periode beku, seluruh transaksi dianggap
mengubah closed period. Anchor pada `startDate` sederhana dan
korrek untuk kasus umum.

**Yang di-enforce (overtime — workDate sebagai anchor):**

| Aksi                                             | `OvertimeRequest.workDate ≤ cutoff`                      |
| ------------------------------------------------ | -------------------------------------------------------- |
| `POST /overtime` (submit)                        | **409 CONFLICT** — `code: PAYROLL_LOCKED`                |
| `POST /overtime/:id/decision` (approve / reject) | **409 CONFLICT** — `code: PAYROLL_LOCKED`                |
| `POST /overtime/:id/cancel` (owner batalkan)     | **409 CONFLICT** — `code: PAYROLL_LOCKED`                |
| **Overtime completion scheduler**                | SKIP dengan reason `PAYROLL_LOCKED` (per-row counter)    |
| SUPER_ADMIN pada aksi decide                     | **Diperbolehkan** (submit tetap tertutup lewat `@Roles`) |

Completion scheduler adalah cross-cutoff hazard yang khusus: APPROVED
→ COMPLETED adalah state yang **payroll count**. Jika cutoff diaktifkan
sementara masih ada APPROVED yang belum COMPLETED di periode beku,
scheduler akan mem-SKIP baris tersebut permanen (tidak ada retry
otomatis setelah cutoff dibuka; scheduler hanya melihat cutoff saat
run). Untuk memproses baris tersebut, HR harus SUPER_ADMIN-override
lewat endpoint decide dulu.

**SUPER_ADMIN bypass rationale:** payroll accidents happen — pembayaran
keluar dengan angka salah, auditor minta koreksi tanggal buka periode,
migrasi data legacy. Ketimbang tidak ada jalur koreksi sama sekali
(dan orang mem-bypass via SQL langsung), kami kanalisasi override
lewat role paling tinggi. Audit log tetap merekam setiap
`ATTENDANCE_MARK_ABSENT / LEAVE_REQUEST_APPROVED / OVERTIME_APPROVED`
dengan `actorId` — jelas siapa yang override.

**Scheduler behavior lebih detail:**

- `AbsenceScannerService.scanCompany(dates, payrollLockedUntil)` mem-filter
  tanggal ≤ cutoff sebelum load roster (short-circuit murah). Cursor
  `lastAbsentScanDate` tetap maju ke tanggal terakhir yang dilewati —
  supaya tick berikutnya tidak retry berulang-ulang.
- Konsekuensi: setelah cutoff aktif, tanggal-tanggal frozen TIDAK
  akan pernah di-scan lagi (bahkan jika HR mundur-in cutoff, karena
  cursor sudah jauh maju). Untuk backfill retroaktif diperlukan
  trigger manual: `POST /attendance/scanner/run` (SUPER_ADMIN only)
  setelah cursor direset via DB console (ops-level operation).

**Config UI:**

- `/admin/company` menampilkan field "Payroll Locked Until" di section
  terpisah dengan warning kuning.
- Team-attendance daily view (`/attendance/team`) mengambil config +
  membandingkan tanggal yang dipilih; bila locked:
  - Menampilkan banner "Periode terkunci payroll".
  - Tombol "Absenkan" & "Batalkan" di-disable dengan tooltip.
  - Server tetap menjadi source-of-truth — SUPER_ADMIN dapat pakai
    endpoint langsung meski UI generic tidak menyediakan tombol
    khusus untuk role ini (dijaga tetap simpel; SUPER_ADMIN operasional
    lewat CLI/API).

**Audit trail:**

- Perubahan `payrollLockedUntil` masuk `AuditLog(action='COMPANY_CONFIG_UPDATED')`
  seperti field lainnya.
- Mark/Unmark yang berhasil bypass cutoff (SUPER_ADMIN) tetap masuk
  `ATTENDANCE_MARK_ABSENT` / `ATTENDANCE_UNMARK_ABSENT` — payroll
  auditor tinggal grep berdasarkan `actorRole` + timestamp untuk
  melihat override history.

### 1.9 Attendance Correction (Employee-Initiated)

**Tujuan:** Karyawan yang lupa clock-in / clock-out tidak menabrak
auto-absent flow dan tidak perlu ping HR di WA. Mereka file "correction
request" formal — mirip mekanisme leave/overtime — yang di-review
supervisor / HR. Kalau disetujui, sistem otomatis materialize koreksi
ke `AttendanceRecord` (create-or-patch, non-destructive).

**Bedanya dengan manual absence override (§1.7):**

| Aspek                    | Manual Absence (§1.7)          | Attendance Correction (§1.9)      |
| ------------------------ | ------------------------------ | --------------------------------- |
| Inisiator                | HR                             | Karyawan                          |
| Efek                     | Tambah / hapus `AbsenceRecord` | Create / patch `AttendanceRecord` |
| Approval chain           | Tidak ada (HR langsung)        | Supervisor / HR single-level      |
| Notification ke karyawan | Ada (informational)            | Ada (submit + decision)           |
| Payroll cutoff           | HR blocked, SUPER_ADMIN bypass | Sama                              |

**Model:** `AttendanceCorrection` (ADR-0011). Field kunci:

- `workDate` — tanggal absensi yang akan dikoreksi.
- `requestedClockInAt` / `requestedClockOutAt` — salah satu wajib
  non-null. Kedua-nya di-serve sebagai UTC ISO.
- `reason` — required, 5–500 char.
- `attachmentUrl` — opsional, S3 key kategori `attendance-correction`.
- `status` enum: `PENDING_APPROVAL → APPROVED / REJECTED / CANCELLED`.
- `supervisorId` — snapshot supervisor saat submit (mirror Leave). Bila
  supervisor berubah setelah submit, request tetap di antrian
  supervisor asal untuk konsistensi.
- `decidedById` / `decidedAt` — approver bukan sama dengan supervisor:
  HR / SUPER_ADMIN juga bisa decide.

**State machine (single-level):**

```
PENDING_APPROVAL ──approve──► APPROVED
                 ──reject───► REJECTED
                 ──cancel───► CANCELLED   (owner only)
```

Bukan two-level seperti Leave — punch correction blast-radius-nya kecil
(patch satu row `AttendanceRecord` untuk satu hari), sedangkan supervisor
sudah tahu apakah bawahannya ada hari itu; second-gate HR akan
menciptakan drag tanpa menambah informasi.

**Endpoint:**

| Method + Path                                           | Role                   | Fungsi                                  |
| ------------------------------------------------------- | ---------------------- | --------------------------------------- |
| `POST /api/v1/attendance/corrections`                   | EMPLOYEE / SUP / HR    | Submit koreksi (self)                   |
| `GET  /api/v1/attendance/corrections/mine`              | any authenticated      | List koreksi milik caller (100 terbaru) |
| `GET  /api/v1/attendance/corrections/approvals/pending` | SUP / HR / SUPER_ADMIN | Antrian pending (scoped by role)        |
| `POST /api/v1/attendance/corrections/:id/decision`      | SUP / HR / SUPER_ADMIN | APPROVE / REJECT                        |
| `POST /api/v1/attendance/corrections/:id/cancel`        | owner-only             | Cancel PENDING                          |

**Pada APPROVE — apply logic (`domain/apply-correction.ts`):**

Fungsi murni `planCorrectionApply(existing, requested)` mengembalikan
satu dari empat action:

1. **`CREATE`** — belum ada `AttendanceRecord` untuk hari itu. Butuh
   `requestedClockInAt` DAN `requestedClockOutAt` (row parsial =
   incomplete session, ditolak).
   - Look up user's shift assignment untuk `workDate` (fallback ke
     assignment terbaru jika tidak match — HR bisa fix assignment
     setelah faktanya).
   - Geo sentinel: lat/lon/accuracy = 0, sebagai marker "created via
     correction". Reports yang peduli kualitas geo tinggal filter
     `clockInAccuracyM = 0`.
   - `note = '[correction {id}]'` untuk traceability.
   - **Bonus:** menghapus `AbsenceRecord` untuk hari itu (jika ada) —
     karyawan sudah membuktikan mereka hadir.
2. **`PATCH`** — sudah ada `AttendanceRecord`, isi field yang null saja.
   Tidak pernah overwrite non-null. Kalau requested value sama dengan
   yang sudah ada → treat sebagai idempotent (silent skip). Untuk
   `clockOutAt` yang baru di-fill, geo sentinel juga (0/0/0).
3. **`NO_OP`** — semua yang diminta sudah cocok dengan yang ada.
   Idempotent replay guard (mis. approver double-click).
4. **`CONFLICT`** — return 409 dengan kode spesifik:
   - `NO_TIMES_REQUESTED` (dijaga juga di service submit).
   - `CONFLICT_CLOCK_IN` / `CONFLICT_CLOCK_OUT` — koreksi mau overwrite
     value non-null yang berbeda. Approver harus reject dulu, karyawan
     ajukan ulang setelah diskusi dengan HR.
   - `INVALID_TIME_ORDER` — clockOut < clockIn di final state.

**Pada REJECT:** hanya update status + `decisionNote`; tidak menyentuh
`AttendanceRecord`. Notification `ATTENDANCE_CORRECTION_REJECTED`
membawa note ke karyawan.

**Notifications:**

| Event                             | Recipient                                      |
| --------------------------------- | ---------------------------------------------- |
| `ATTENDANCE_CORRECTION_SUBMITTED` | Supervisor (bila `user.supervisorId` non-null) |
| `ATTENDANCE_CORRECTION_APPROVED`  | Requester                                      |
| `ATTENDANCE_CORRECTION_REJECTED`  | Requester (dengan `decisionNote`)              |

Bila `user.supervisorId = null`, submitted notification di-skip — HR
polling `/approvals/pending` sudah cukup, tidak worth broadcast ke semua
HR user (bisa jadi spam).

**Payroll cutoff (§1.8 rules apply):**

- `submit` / `decide` / `cancel` dengan `workDate <= payrollLockedUntil`
  → 409 `PAYROLL_LOCKED` untuk non-SUPER_ADMIN.
- Sama dengan Leave/Overtime, SUPER_ADMIN bypass di-encode di helper
  `common/domain/payroll-lock`.
- **Cancel** juga dijaga cutoff (bukan cuma submit + decide) — cancellation
  post-payroll bisa terlihat innocuous tapi karyawan bisa retract PENDING
  request-nya untuk hide dari audit trail. Lebih baik consistent-block
  daripada special-case.

**Attachment upload:**

Kategori `attendance-correction` di `AttachmentPurpose`. Alur:

1. FE panggil `POST /attachments/presign` dengan `purpose = 'attendance-correction'`.
2. `PUT` file ke S3.
3. Submit dengan `attachmentKey = fileKey` yang di-return.

Owner-check di server memastikan key milik caller (companyId + userId
match). Attachment di-serve via presigned GET URL yang dibuat ulang setiap
kali response — leaked link auto-expire.

**Audit trail:**

| Action                            | Kapan                                         |
| --------------------------------- | --------------------------------------------- |
| `ATTENDANCE_CORRECTION_SUBMITTED` | Setelah submit sukses                         |
| `ATTENDANCE_CORRECTION_APPROVED`  | Setelah APPROVE (before/after JSON tersimpan) |
| `ATTENDANCE_CORRECTION_REJECTED`  | Setelah REJECT                                |
| `ATTENDANCE_CORRECTION_CANCELLED` | Setelah owner cancel                          |

`AttendanceRecord` yang diciptakan / di-patch oleh correction tidak
memiliki flag khusus — audit trail-nya di `AuditLog` (via
`entityId = correction.id`). Diputuskan agar tidak menambah field
`source` di `AttendanceRecord`; ADR-0011 mendokumentasikan trade-off ini.

### 1.10 Approvals Backlog (Cross-Module HR Visibility)

**Tujuan:** Setelah kami punya 3 modul dengan approval workflow (Leave,
Overtime, Attendance Correction), masing-masing dengan antrian
`/approvals/pending` sendiri, HR tidak lagi punya cara cepat untuk
mengetahui **berapa total permintaan yang menunggu keputusan** di
seluruh organisasi — dan yang lebih penting, **berapa yang sudah
"rotting" (menunggu >3 hari)**.

Fase 20 menambahkan endpoint agregasi + tile ringkas di HR company
dashboard + halaman detail untuk drill-down. Ini bukan fitur bisnis
baru — semua request-nya sudah ada; kami hanya membuka
"single-pane-of-glass" ke keadaan operasional saat ini.

**Endpoint:** `GET /api/v1/admin/approvals/backlog`

| Query param     | Default | Range    | Fungsi                                           |
| --------------- | ------- | -------- | ------------------------------------------------ |
| `thresholdDays` | `3`     | `1`…`60` | Ambang batas hari untuk klasifikasi "stale"      |
| `topN`          | `5`     | `1`…`20` | Jumlah baris tertua per modul (untuk drill-down) |

**RBAC:** hanya `HR_MANAGER` + `SUPER_ADMIN`. Supervisor sengaja tidak
diberi akses — mereka sudah punya scoped-view di
`/leave/approvals/pending` / `/overtime/approvals/pending` /
`/attendance/corrections/approvals/pending`. Menambah cross-module
aggregate untuk supervisor akan mengaburkan batas ownership dan
menciptakan surface yang tidak jelas siapa yang bertanggung jawab
menindaklanjuti.

**Response shape (per modul, 3× identik):**

```jsonc
{
  "generatedAt": "2026-08-02T05:14:22.183Z",
  "staleAfterDays": 3,
  "leave":       { /* ModuleBacklog */ },
  "overtime":    { /* ModuleBacklog */ },
  "correction":  { /* ModuleBacklog */ }
}
// ModuleBacklog:
{
  "total":  10,               // semua PENDING regardless of umur
  "fresh":   7,               // umur < staleAfterDays
  "stale":   3,               // umur >= staleAfterDays
  "buckets": {                // histogram — INDEPENDEN dari threshold
    "d0_1": 4,                //   [0d, 1d)  — belum butuh perhatian
    "d1_3": 3,                //   [1d, 3d)  — normal turn-around
    "d3_7": 2,                //   [3d, 7d)  — perlu nudge
    "d7_plus": 1              //   [7d, ∞)   — escalate
  },
  "oldest": [                 // sorted ascending createdAt; length ≤ topN
    { "id": …, "userId": …, "userFullName": …,
      "createdAt": …, "ageDays": 9,
      "summary": "Annual · 2026-08-15 → 2026-08-15" }
  ]
}
```

**Query strategy:** 3× `findMany` paralel via `Promise.all`, masing-masing
sudah ter-tenant-scoped (`companyId`) + status-filtered. `orderBy` `createdAt`
ascending memastikan `oldest[]` bisa langsung `slice(0, topN)` tanpa
extra sort di Node.

**Age-bucket computation di Node, bukan SQL:** Postgres date arithmetic
sensitif terhadap DST + waktu-server-vs-tenant-timezone; pindahkan
klasifikasi ke Node menggunakan `now.getTime() - createdAt.getTime()` +
`Math.floor(ms / 86400000)` menghilangkan ambiguitas. Ukuran list per
tenant sangat kecil (≤ ratusan) — CPU cost tidak signifikan.

**FE integration:**

- `BacklogTile` di `/attendance/dashboard` — tampilan ringkas: total
  pending + total stale + 3 chip per-modul. Chip warna dinamis:
  emerald (semua fresh), primary (ada pending), destructive (ada stale).
  Klik chip → langsung ke antrian modul terkait.
- `/admin/approvals-backlog` — tampilan detail dengan threshold slider
  (1–14 hari, `topN=10`), 3 module card side-by-side, histogram bucket
  cell-by-cell, dan daftar 10 baris tertua per modul dengan age-badge.

**Design NON-goals (di-defer ke follow-up):**

- Notification "stale approvals digest" (daily email ke HR). Bisa
  ditambah nanti sebagai cron yang memanggil service ini — helper-nya
  sudah siap.
- Auto-escalation supervisor → HR setelah N hari. Kompleks (ownership,
  RBAC drift) dan value marjinal — HR punya visibility sekarang; kalau
  perlu escalate, mereka klik "buka antrian" dan approve langsung.
- Persistence historical (untuk trend chart backlog dari waktu ke
  waktu). Backlog view saat ini adalah **snapshot live**, dihitung
  on-demand. Historical akan butuh scheduler + storage — sudah masuk
  "consider later" backlog.

### 1.11 Notification Preferences (Per-User Opt-Out)

Sistem notifikasi (in-app + email) sudah cukup luas (15 tipe event).
Fase 22 memberi tiap user tombol opt-out per **tipe × channel** agar
mengurangi noise tanpa mengorbankan sinyal penting.

**Model penyimpanan (overrides only):**

Tabel `NotificationPreference (userId, type, emailEnabled, inAppEnabled)`
dengan unique `(userId, type)`. **Tidak ada row = "kedua channel
nyala"** (defaults-on). Rasional detail di ADR-0012 §D1 — kami tidak
menyimpan matrix `|users| × |types|` untuk menghemat storage dan
memberi user baru default aman (subscribed ke semuanya).

**Tipe wajib (tidak bisa di-opt-out):**

| Tipe             | Alasan                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `PASSWORD_RESET` | Sinyal keamanan. Kalau seseorang me-reset password Anda, konfirmasi harus terkirim tanpa kompromi. |

Daftar diatur di `notification/domain/preferences.ts` (konstanta
`mandatoryNotificationTypes`). Menambahkan tipe wajib = policy
decision, harus di-review di PR dan bumping ADR-0012.

**Endpoints:**

| Endpoint                                | Role                | Semantik                                                                                                                                                                                                                              |
| --------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/notifications/preferences` | Semua authenticated | Kembalikan 15 baris (satu per `NotificationType`) dengan nilai efektif + flag `mandatory`.                                                                                                                                            |
| `PUT /api/v1/notifications/preferences` | Semua authenticated | Bulk upsert: body `{ updates: [{ type, emailEnabled, inAppEnabled }] }`. Tipe wajib silently di-drop. Empty updates = no-op yang tetap balikan list default. Response = fresh full list (FE bisa langsung seed cache tanpa GET lagi). |

**Fanout gate (`NotificationService.createOne`):**

Setiap panggilan `createOne` sekarang melakukan **satu lookup preference**
sebelum menulis in-app row dan sebelum dispatch email. Semantik gate:

- `inAppEnabled=false` → row `Notification` tidak dibuat. (Bukan
  "buat lalu sembunyikan" — itu akan tetap muncul di `unreadCount`.)
- `emailEnabled=false` → email tidak di-dispatch.
- Keduanya false → whole delivery no-op (log level debug).
- Mandatory type → gate mengembalikan `{true,true}` regardless of row.
  `PASSWORD_RESET` selalu terkirim.

Lookup jalan pada handle transaksi yang sama dengan penulisan in-app
sehingga snapshot konsisten — user yang opt-out mid-flight tidak
menghasilkan phantom row.

**FE `/settings/notifications`:**

Halaman menyajikan matrix per section (Cuti, Lembur, Absensi, Keamanan)
dengan checkbox in-app + email per baris. Row mandatory ditandai pill
"Wajib" dan toggle-nya locked. Draft di client — hanya satu PUT saat
klik Simpan (bukan per klik toggle).

Response PUT authoritative → FE seed `queryClient.setQueryData` tanpa
follow-up GET.

### 1.12 Audit Log Viewer (HR / Compliance Read Surface)

`AuditLog` sudah diisi sejak awal proyek di semua mutasi sensitif —
leave decisions, overtime, absence override, correction workflow,
scanner cursor reset, company config, notification preferences (implicit
via updatedAt), dsb. Tabel bersifat **append-only**
(intended posture: `REVOKE UPDATE, DELETE ON "AuditLog"` di role level).
Fase 23 menambahkan endpoint + halaman untuk HR/compliance browse
tanpa akses DB langsung.

**Endpoint:**

`GET /api/v1/admin/audit-log?entityType&entityId&actorId&action&from&to&cursor&limit`
(HR_MANAGER + SUPER_ADMIN, throttled 30 req/min).

- Response: `{ rows: AuditLogRow[], nextCursor: string | null }`.
- Setiap row memuat `id, action, entityType, entityId, actorId,
actorName, actorEmail, beforeJson, afterJson, ip, userAgent,
createdAt`. Actor join dilakukan di query time (satu round-trip).
- Ordering: `createdAt DESC, id DESC` — newest first, deterministik
  antar row dengan timestamp yang sama.
- Pagination: **keyset over `(createdAt, id)`** via cursor
  base64url-encoded. Malformed cursor → 400 `INVALID_CURSOR`.
- Limit: default 25, cap 100.

**Tenancy — strict:**

Query di-scope `WHERE companyId = actor.companyId`. **SUPER_ADMIN
tidak punya lane cross-tenant** lewat endpoint ini — cross-tenant
investigation harus lewat SQL escalation (yang menghasilkan trail
sendiri di sesi DBA). Rasional detail di ADR-0013 §D2.

**Filter matrix:**

| Filter       | Semantik                                                                   |
| ------------ | -------------------------------------------------------------------------- |
| `entityType` | Exact match (`LeaveRequest`, `Company`, `AbsenceRecord`, dst.)             |
| `entityId`   | Exact match. Paling selektif kalau dikombinasi dengan `entityType`.        |
| `actorId`    | Exact match `User.id`. Kombinasi dengan `from/to` sangat efisien di index. |
| `action`     | Exact match (`LEAVE_REQUEST_APPROVED`, `SCANNER_CURSOR_RESET`, dst.)       |
| `from`, `to` | ISO 8601. Inclusive range di `createdAt`.                                  |

Kombinasi apapun sah — Postgres memilih index terbaik antara
`(companyId, entityType, entityId)` dan `(actorId, createdAt)`.
**Free-text search TIDAK di-support** (butuh `pg_trgm` yang belum
di-provision).

**FE `/admin/audit-log`:**

- Filter panel di atas (grid 4 kolom di desktop): entityType, action,
  actorId, entityId, from, to + Reset filter.
- Input `entityType` dan `action` menyediakan **autocomplete via
  `<datalist>`** dari katalog `audit-catalog.ts` (semua tipe/aksi
  yang backend writers tulis hari ini). Katalog bersifat soft-hint:
  API tetap menerima string apapun, jadi writer baru dari backend
  tidak akan pecah — cuma tidak muncul di dropdown sampai katalog
  di-refresh.
- Tabel: waktu, aksi (font-mono), entitas (type + id kecil), pelaku
  (name + email), IP, tombol "Diff".
- **Click-to-filter**: setiap sel `aksi`, `entityType`, `entityId`,
  dan nama pelaku bertindak sebagai tombol yang meng-apply filter
  itu ke panel di atas (lalu smooth-scroll ke atas). Contoh flow:
  klik pelaku `HR Manager` → filter `actorId=<id>` aktif → tabel
  berisi hanya event dari orang itu. Klik lagi `entityType=LeaveRequest`
  → filter berlapis "leave requests yang ditangani HR Manager". Klik
  Reset filter untuk kembali ke tampilan awal.
- **External-link icon (`↗`)** muncul di sebelah `entityType=Company`,
  meng-arahkan ke `/admin/company` (satu-satunya tipe entitas dengan
  halaman detail hari ini). Ketika tipe entitas lain memperoleh
  halaman detail, tambahkan mapping di `externalRouteFor()`
  (`components/features/admin/audit/audit-catalog.ts`).
- Klik "Diff" → row expansion inline menampilkan `beforeJson` vs
  `afterJson` sebagai **shallow key-by-key diff** dengan status
  `sama / diubah / ditambah / dihapus` dan warna. UA (userAgent) juga
  ditampilkan di bawah diff kalau ada.
- "Muat lebih banyak" pagination via `useInfiniteQuery`. QueryKey
  di-derive dari filter tanpa `cursor` → page-N tidak invalidate
  page-1's render.

**Kapan pakai:**

- Auditor bertanya "siapa yang setujui cuti X?" → filter
  `entityType=LeaveRequest&entityId=<id>`.
- Compliance review "semua perubahan konfigurasi 30 hari terakhir" →
  filter `entityType=Company&from=<30d ago>`.
- Investigasi user tertentu → filter `actorId=<user id>` (range date
  opsional).
- "Kapan cursor scanner terakhir di-reset?" → filter
  `action=SCANNER_CURSOR_RESET`.

**NDJSON export (Fase 26 / ADR-0013 follow-up):**

`GET /api/v1/admin/audit-log/export?entityType&entityId&actorId&action&from&to`
(HR + SUPER_ADMIN, throttled 3 req/min) — streaming NDJSON download.
Filter set identik dengan JSON list minus `cursor`/`limit`.

- **Format:** `application/x-ndjson`, satu event per baris, tanpa
  wrapping envelope. Kompatibel dengan `jq`, `pandas.read_json(lines=True)`,
  atau importer streaming NDJSON manapun.
- **Filename:** `audit-log-YYYY-MM-DD.ndjson` (UTC) di
  `Content-Disposition`.
- **Row cap 100.000 per request** — beyond that stream berhenti
  mid-file (partial file valid). Untuk range lebih besar, pecah via
  `from`/`to`.
- **Backpressure aware:** server menunggu `drain` sebelum menjadwalkan
  batch Postgres berikutnya, jadi client lambat tidak menyebabkan
  Node OOM.
- **Client disconnect aman:** async generator berhenti otomatis
  ketika socket ditutup — tidak ada round-trip Postgres yang wasted.
- **Tetap strict tenant:** SUPER_ADMIN tidak bisa ekspor tenant lain.

FE tombol "Ekspor NDJSON" muncul di atas tabel viewer, mengirim
filter set yang aktif saat itu. Progress ditandai dengan label
tombol "Menghasilkan file…" — file diunduh sekali response body
selesai.

Kapan pakai:

- Compliance minta "audit event Q3" untuk analisis eksternal
  (Excel / Power BI import via NDJSON connector).
- Backup periodik ke cold storage (cron script yang memanggil
  endpoint per bulan dengan `from`/`to`).
- Deep-dive investigasi yang butuh full-text grep di file lokal.

### 1.13 Notification Archive + Mark-All-Read

Bell dropdown (Fase 6 / ADR-0006) menampilkan 20 baris terbaru
dengan polling `unread-count` tiap 30 s. Ini cukup untuk "quick
peek", tapi kalau user jarang buka bell, unread cepat menumpuk
sampai ratusan dan tidak actionable. Fase 25 menambahkan (a)
endpoint arsip **paginated** untuk browse riwayat penuh, dan (b)
halaman `/notifications` yang mengekspos itu ke user.

**Endpoints:**

| Endpoint                                       | Semantik                                                                                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/notifications`                    | Bell dropdown feed — flat array, max 20 (klamp 1..100), newest-first. Tidak paginated karena bell tidak butuh browse. **Tidak berubah di Fase 25.**                                                                         |
| `GET /api/v1/notifications/unread-count`       | Cheap counter. Polled 30 s. Tidak berubah.                                                                                                                                                                                  |
| `POST /api/v1/notifications/:id/read`          | Mark-read satu row. Idempotent (baris yang sudah read tetap 204). Tidak berubah.                                                                                                                                            |
| `POST /api/v1/notifications/read-all`          | Mark-read semua row unread milik caller. Response `{ marked: number }`. Endpoint sudah ada sejak MVP; ekspor ke dua UI di Fase 25 (bell + archive).                                                                         |
| **`GET /api/v1/notifications/archive`** (baru) | Paginated archive. Query: `unreadOnly=(true\|false)`, `limit` (default 25, klamp 1..100), `cursor`. Response: `{ rows, nextCursor }`. Newest-first, keyset atas `(createdAt, id)`. Malformed cursor → 400 `INVALID_CURSOR`. |

**Kenapa dua endpoint (`GET /notifications` vs `GET /notifications/archive`):**

Bell hanya butuh 20 row terbaru dan tidak pernah paginate — tambah
envelope `{ rows, nextCursor }` untuk pemakaian itu bikin FE parsing
lebih berat tanpa manfaat. Archive butuh pagination, jadi
envelope-nya wajib. Dua caller, dua bentuk. Underlying storage query
sama (composite index `(recipientId, createdAt)` + condition
opsional `readAt IS NULL`), tapi return shape berbeda supaya FE
tidak perlu spread-versus-envelope handling.

**FE `/notifications`:**

- Tab **Semua** / **Belum dibaca** — mengubah query key
  `useInfiniteQuery` sehingga pindah tab = walking keyset baru
  (cursor lama tidak valid antar mode filter).
- Tombol **Tandai semua dibaca** di header — panggil
  `POST /read-all`, lalu `invalidateQueries(['notifications'])`
  sehingga bell + archive keduanya sync.
- Baris menampilkan title + body + type (badge kecil) + relative
  timestamp; kalau row punya `data.href`, seluruh baris berperilaku
  Link dan otomatis mark-read saat diklik.
- Optimistic mark-read: state per-row di-flip lokal dulu, unread
  count di-decrement, rollback kalau server menolak.
- "Muat lebih banyak" pagination via `useInfiniteQuery`
  (`nextCursor` dari page-N jadi `pageParam` page-(N+1)).

**Bell dropdown perubahan:**

Tambah footer `Lihat semua notifikasi →` yang menghubungkan ke
`/notifications`. Menutup dropdown saat diklik.

**Kapan pakai archive:**

- User mau melihat notifikasi dari minggu lalu yang sudah hilang
  dari bell (bell hanya 20 terbaru).
- HR mau audit "kapan aku menerima notifikasi X?" — filter unread
  false, scroll ke bawah, cari.
- Sebelum "mass mark-as-read" untuk clear inbox visual.

## 2. Manajemen Cuti (Leave)

### 2.1 Balance Invariant

Untuk setiap baris `LeaveBalance` harus SELALU berlaku:

```
remaining == quota + carriedOver - used - reserved
```

`reserved` merepresentasikan **soft-hold** pada pool: menghitung days yang tercadang untuk pengajuan yang belum final. `used` adalah day yang sudah `APPROVED`.

### 2.2 State Machine & Transisi Saldo

| Dari                 | Event              | Ke           | `reserved` Δ | `used` Δ | `remaining` Δ |
| -------------------- | ------------------ | ------------ | :----------: | :------: | :-----------: |
| `PENDING_SUPERVISOR` | supervisor APPROVE | `PENDING_HR` |      0       |    0     |       0       |
| `PENDING_SUPERVISOR` | supervisor REJECT  | `REJECTED`   |    −days     |    0     |     +days     |
| `PENDING_SUPERVISOR` | owner CANCEL       | `CANCELLED`  |    −days     |    0     |     +days     |
| `PENDING_HR`         | HR APPROVE         | `APPROVED`   |    −days     |  +days   |       0       |
| `PENDING_HR`         | HR REJECT          | `REJECTED`   |    −days     |    0     |     +days     |
| `PENDING_HR`         | owner CANCEL       | `CANCELLED`  |    −days     |    0     |     +days     |

Terminal states (`APPROVED`, `REJECTED`, `CANCELLED`) tidak menerima transisi. Setiap transisi menulis `AuditLog` dalam transaksi yang sama.

### 2.3 Submit (`POST /api/v1/leave`)

1. Zod-validasi (`leaveRequestInputSchema`) + DTO `class-validator`.
2. Cari `leaveType` di tenant caller → 404 `LEAVE_TYPE_NOT_FOUND`.
3. Jika `leaveType.requiresAttachment` dan tidak ada `attachmentKey` → 400 `ATTACHMENT_REQUIRED`. Jika `attachmentKey` diisi tapi prefix tidak match `attachments/leave-attachment/{companyId}/{userId}/…` → 400 `ATTACHMENT_KEY_INVALID`. **Alur upload:** FE panggil `POST /attachments/presign` terlebih dulu → `PUT` file langsung ke S3 → submit dengan `attachmentKey` = `fileKey` yang dikembalikan (lihat §8).
4. Hitung `days` = business days (skip weekend & `Holiday.date` company) → jika 0: 400 `ZERO_BUSINESS_DAYS`.
5. Cek overlap terhadap request tenant yang statusnya `PENDING_SUPERVISOR / PENDING_HR / APPROVED` → 409 `OVERLAPPING_REQUEST`.
6. `prisma.$transaction` (Serializable):
   - `SELECT ... FOR UPDATE` pada `LeaveBalance` (userId, leaveTypeId, year). Jika belum ada, seed dari `leaveType.defaultAnnualQuota` lalu re-lock.
   - Cek `balance.remaining >= days` → jika tidak: 400 `INSUFFICIENT_BALANCE`.
   - `reserved += days`, `remaining -= days`, `version += 1`.
   - Create `LeaveRequest { status: PENDING_SUPERVISOR, supervisorId: currentSupervisorOfUser }`.
   - AuditLog `LEAVE_REQUEST_SUBMITTED`.

### 2.4 Decide (`POST /api/v1/leave/:id/decision`)

Body: `{ action: 'APPROVE' | 'REJECT', note?: string }`. Global `RolesGuard` membatasi endpoint ke `SUPERVISOR | HR_MANAGER | SUPER_ADMIN`. Layer service masih memeriksa:

- Untuk `PENDING_SUPERVISOR`, actor `SUPERVISOR` **harus** menjadi `user.supervisorId` dari requester (403 `FORBIDDEN`).
- Untuk `PENDING_HR`, hanya `HR_MANAGER` / `SUPER_ADMIN` yang boleh (di-enforce oleh state machine).
- State machine mengembalikan `IllegalTransitionError` jika event tidak valid di state saat ini → 409 `ILLEGAL_TRANSITION`.

Perhitungan balance mengikuti tabel §2.2, dieksekusi di dalam Serializable transaction dengan `FOR UPDATE`.

### 2.5 Cancel (`POST /api/v1/leave/:id/cancel`)

- Hanya pemilik request (`request.userId === actor.id`) yang boleh membatalkan.
- Hanya dari `PENDING_SUPERVISOR` atau `PENDING_HR`; state terminal → 409.
- Release `reserved`, tambah `remaining`, audit.

### 2.6 Error Codes

| Code                          | HTTP | UI Copy (ID)                                                      |
| ----------------------------- | ---- | ----------------------------------------------------------------- |
| `INSUFFICIENT_BALANCE`        | 400  | Saldo cuti tidak cukup untuk rentang ini.                         |
| `ZERO_BUSINESS_DAYS`          | 400  | Rentang tanggal tidak berisi hari kerja.                          |
| `OVERLAPPING_REQUEST`         | 409  | Ada pengajuan lain yang bertabrakan.                              |
| `ATTACHMENT_REQUIRED`         | 400  | Jenis cuti ini membutuhkan lampiran.                              |
| `ILLEGAL_TRANSITION`          | 409  | Status pengajuan sudah berubah. Muat ulang halaman.               |
| `LEAVE_TYPE_NOT_FOUND`        | 404  | Jenis cuti tidak ditemukan.                                       |
| `BALANCE_INVARIANT_VIOLATION` | 409  | Anomali saldo (tidak seharusnya terjadi — investigasi audit log). |

### 2.7 Carry-Over (annual scheduler — TBD)

Job scheduler tahunan (belum diimplementasi, ADR-0005 kelak) menjalankan:

```
carriedOver = min(previous.remaining, leaveType.carryOverMax)
quota       = leaveType.defaultAnnualQuota
used        = 0
reserved    = 0
remaining   = quota + carriedOver
```

## 3. Izin & Sakit (Permits & Sick Leaves)

Turunan dari `LeaveRequest` dengan `LeaveType.kind = SICK | PERSONAL | OTHER`. Ketika `LeaveType.requiresAttachment = true`, `LeaveRequest.attachmentUrl` wajib (validasi di service). Attachment diupload via presigned URL (S3) atau storage lokal (`STORAGE_DRIVER=local`).

## 4. Lembur (Overtime)

### 4.1 Model & State Machine

`OvertimeRequest` menyimpan snapshot lengkap kalkulasi pembayaran untuk
kebutuhan audit:

| Field               | Tipe                  | Semantik                                                            |
| ------------------- | --------------------- | ------------------------------------------------------------------- |
| `workDate`          | `Date` (UTC-midnight) | Tanggal kerja lembur — kalender lokal tenant                        |
| `hours`             | `Decimal(5,2)`        | 0 < h ≤ `Company.overtimeMaxHoursPerDay` (default 4)                |
| `baseRate`          | `Decimal(12,2)`       | Snapshot: `User.overtimeHourlyRate` ?? `Company.overtimeHourlyRate` |
| `rateMultiplier`    | `Decimal(4,2)`        | Diambil dari kebijakan Company berdasarkan `dayKind`                |
| `ratePerHour`       | `Decimal(12,2)`       | `baseRate × rateMultiplier` (denormalized)                          |
| `totalAmount`       | `Decimal(14,2)`       | `hours × ratePerHour` (denormalized)                                |
| `dayKind` (derived) | enum                  | `WEEKDAY` / `WEEKEND` / `HOLIDAY` — dihitung ulang saat read        |

**State transitions:**

```
PENDING_APPROVAL ──approve──► APPROVED
PENDING_APPROVAL ──reject───► REJECTED
PENDING_APPROVAL ──cancel───► CANCELLED    (hanya pemilik)
APPROVED         ──complete─► COMPLETED    (scheduler — see §4.6)
```

Approver adalah **satu tingkat** — berbeda dari cuti yang dua-tingkat. Aturan:

- `SUPERVISOR`: hanya boleh memutuskan pengajuan dari subordinat langsung
  (`request.user.supervisorId === actor.id`).
- `HR_MANAGER` / `SUPER_ADMIN`: boleh memutuskan seluruh pengajuan tenant.
- `EMPLOYEE`: tidak pernah bisa memutuskan (termasuk pengajuan sendiri).

### 4.2 Klasifikasi Hari & Multiplier

Domain `overtime-rate.ts` — pure, framework-agnostic:

```
if workDate ∈ Company.holidays  → HOLIDAY   × overtimeHolidayMultiplier   (default 3.0)
elif getUTCDay(workDate) ∈ {0,6} → WEEKEND   × overtimeWeekendMultiplier   (default 2.0)
else                             → WEEKDAY   × overtimeWeekdayMultiplier   (default 1.5)
```

Prioritas `HOLIDAY > WEEKEND` — hari libur yang jatuh di Sabtu/Minggu **tidak**
menstack multiplier; hanya multiplier `HOLIDAY` (yang biasanya tertinggi) yang
dipakai. Kebijakan bisa dikustomisasi per-tenant via `Company.overtime*`.

### 4.3 Submit (`POST /api/v1/overtime`)

1. Zod validate `overtimeRequestInputSchema`.
2. Load `User` + `Company` policy dalam satu round-trip.
3. Aturan **wajib**:
   - `workDate` tidak boleh masa depan → 400 `WORK_DATE_IN_FUTURE`.
   - `workDate ≥ today − Company.overtimeSubmitWindowDays` → 400 `OUTSIDE_SUBMIT_WINDOW` (default 14 hari).
   - `hours` dengan `assertOvertimeHours` → 400 `HOURS_NOT_POSITIVE` / `HOURS_TOO_MANY_DECIMALS` / `HOURS_EXCEEDS_DAILY_CAP`.
   - Tidak boleh ada request aktif (`PENDING_APPROVAL` | `APPROVED` | `COMPLETED`) untuk `(userId, workDate)` yang sama → 409 `DUPLICATE_WORK_DATE`. Row `REJECTED` / `CANCELLED` **boleh** di-retry (partial-unique tidak di-enforce di DB — hanya di service).
   - Tarif dasar harus tersedia (user override ATAU company default) → 400 `OVERTIME_RATE_NOT_CONFIGURED`.
4. Hitung rate + amount lewat `computeOvertimeRate` (pure).
5. `prisma.$transaction`:
   - Insert `OvertimeRequest { status: PENDING_APPROVAL, baseRate, rateMultiplier, ratePerHour, totalAmount }`.
   - Insert `AuditLog { action: 'OVERTIME_SUBMITTED', afterJson: { dayKind, hours, ratePerHour, totalAmount } }`.

### 4.4 Decide (`POST /api/v1/overtime/:id/decision`)

Body: `{ action: 'APPROVE' | 'REJECT', note?: string }`.
`RolesGuard` membatasi endpoint ke `SUPERVISOR | HR_MANAGER | SUPER_ADMIN`.

Service memuat request → panggil state machine `transition(currentStatus, event)`.
Event `{ kind: 'APPROVE'|'REJECT', actorRole, isTeamSupervisor }`:

- `SUPERVISOR` non-tim → `ForbiddenTransitionError` → 400 `FORBIDDEN`.
- State bukan `PENDING_APPROVAL` → `IllegalTransitionError` → 409 `ILLEGAL_TRANSITION`.

Pada approve: `approvedById`, `approvedAt` di-set. Pada reject: `approvedById`
(yang memutuskan) + `rejectedAt` di-set. Keduanya juga menuliskan `decisionNote`.

### 4.5 Cancel (`POST /api/v1/overtime/:id/cancel`)

- Hanya pemilik (`request.userId === actor.id`) yang boleh membatalkan.
- Hanya dari `PENDING_APPROVAL`. State terminal → 409 `ILLEGAL_TRANSITION`.
- Tidak ada balance yang perlu di-release (berbeda dari cuti).

### 4.6 Complete (Scheduler)

`APPROVED → COMPLETED` **tidak** dipicu manusia. Sebuah cron job harian
mempromote setiap pengajuan `APPROVED` yang lolos dua uji:

1. **Grace period lewat** — hari ini > `workDate + company.overtimeCompleteGraceDays`
   (default 2 hari). Grace ini memberi ruang untuk timesheet manual yang
   di-input belakangan (mis. supervisor mencatat kehadiran Jumat pada Senin
   berikutnya).
2. **Kehadiran terverifikasi** — ada `AttendanceRecord` non-deleted untuk
   `(userId, workDate)` dengan **clock-in dan clock-out** keduanya terisi.
   Punch setengah (clock-in saja) tidak dianggap bukti kehadiran.

**Waktu eksekusi:** `0 0 2 * * *` (setiap hari 02:00 waktu server) — jam
sepi setelah koreksi timesheet harian tapi sebelum HR review pagi.

**Windowing:** hanya memindai baris dengan `workDate ≥ now - 90 hari`. Baris
yang lebih tua dianggap "dead-lettered" — jika masih `APPROVED` setelah 90+
hari, kemungkinan besar butuh intervensi manual (mis. absensi hilang
permanen). Ini menjaga runtime scheduler tetap linear terhadap aktivitas
baru, bukan ukuran tabel.

**Idempotency:** aman dipanggil berulang kali. Baris `COMPLETED` yang tidak
sengaja masuk hasil query di-skip di layer domain (`ALREADY_COMPLETED`).
Setiap update per-baris adalah transaksi kecil sendiri — kegagalan di baris
ke-N tidak membatalkan baris 0..N-1.

**Efek write:** `status = 'COMPLETED'`, `completedAt = now`. Tidak ada
`AuditLog` yang ditulis untuk transisi ini (actor system tidak mempunyai
`User` row; jejak audit tersimpan permanen di kolom `completedAt`). Log
terstruktur dikirim ke NestJS `Logger` untuk observability (Datadog / stdout).

**Trigger manual:** `POST /api/v1/admin/overtime/run-completion` (HR_MANAGER
atau SUPER_ADMIN). Endpoint idempoten dan di-scope ke `companyId` pemanggil,
sehingga SUPER_ADMIN pada tenant A tidak dapat mempromote baris tenant B.
Rate-limited 4 req/menit. UI: tombol "Jalankan sekarang" pada
`/overtime/approvals`.

**Response body (manual run):**

```json
{
  "scanned": 42,
  "completed": 37,
  "skipped": {
    "GRACE_NOT_MET": 3,
    "NO_ATTENDANCE": 2
  },
  "durationMs": 214
}
```

Alasan skip yang mungkin: `ALREADY_COMPLETED`, `NOT_APPROVED`, `GRACE_NOT_MET`,
`NO_ATTENDANCE`, `INCOMPLETE_ATTENDANCE`, `PROMOTE_FAILED`.

**Interaksi dengan laporan (§6.1.3):**

- `APPROVED` = disetujui tapi kehadiran belum terverifikasi → tampil di
  audit report tapi biasanya **tidak** dibayar (payroll view default
  memfilter ke `COMPLETED` saja jika HR mau).
- `COMPLETED` = disetujui **dan** dikonfirmasi hadir → aman untuk payroll.

Default filter laporan payroll (`APPROVED` + `COMPLETED`) memungkinkan HR
memilih kebijakan: bayar segera setelah approve, atau tunggu completion.

### 4.7 Error Codes

| Code                           | HTTP | UI Copy (ID)                                                                                                                                                                                          |
| ------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_DATE`                 | 400  | Format tanggal tidak valid.                                                                                                                                                                           |
| `WORK_DATE_IN_FUTURE`          | 400  | Tanggal kerja tidak boleh di masa depan.                                                                                                                                                              |
| `OUTSIDE_SUBMIT_WINDOW`        | 400  | Tanggal kerja di luar jendela pengajuan (mis. H-14).                                                                                                                                                  |
| `DUPLICATE_WORK_DATE`          | 409  | Sudah ada pengajuan lembur aktif untuk tanggal tersebut. Enforced di service **dan** partial unique index DB (`OvertimeRequest_userId_workDate_active_uidx`) — race concurrent submit auto ter-catch. |
| `HOURS_NOT_POSITIVE`           | 400  | Jam lembur harus lebih dari 0.                                                                                                                                                                        |
| `HOURS_TOO_MANY_DECIMALS`      | 400  | Jam lembur maksimum 2 angka di belakang koma.                                                                                                                                                         |
| `HOURS_EXCEEDS_DAILY_CAP`      | 400  | Jam melebihi batas harian perusahaan.                                                                                                                                                                 |
| `OVERTIME_RATE_NOT_CONFIGURED` | 400  | Tarif lembur belum dikonfigurasi.                                                                                                                                                                     |
| `ILLEGAL_TRANSITION`           | 409  | Status sudah berubah. Muat ulang.                                                                                                                                                                     |
| `FORBIDDEN`                    | 400  | Anda tidak berwenang memutuskan pengajuan ini.                                                                                                                                                        |
| `OVERTIME_NOT_FOUND`           | 404  | Pengajuan tidak ditemukan.                                                                                                                                                                            |

### 4.8 Konfigurasi (Company)

| Field                       | Default                      | Semantik                                                                              |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| `overtimeHourlyRate`        | `null` (tenant belum config) | Base rate default. Wajib set salah satu (User override / Company).                    |
| `overtimeWeekdayMultiplier` | `1.5`                        | Multiplier hari kerja biasa.                                                          |
| `overtimeWeekendMultiplier` | `2.0`                        | Multiplier Sabtu/Minggu (kecuali overlap dengan libur).                               |
| `overtimeHolidayMultiplier` | `3.0`                        | Multiplier hari libur nasional/company.                                               |
| `overtimeMaxHoursPerDay`    | `4.0`                        | Batas jam per hari yang diperbolehkan diajukan.                                       |
| `overtimeSubmitWindowDays`  | `14`                         | Berapa hari ke belakang boleh diajukan.                                               |
| `overtimeCompleteGraceDays` | `2`                          | Tenggang setelah `workDate` sebelum scheduler mempromote ke `COMPLETED` (lihat §4.6). |

Per-user override `User.overtimeHourlyRate` dipakai bila set (untuk gaji yang
berbeda per level). Multiplier selalu company-wide.

## 5. Admin — User & Department Management

Semua endpoint pada seksi ini berada di prefix `/api/v1/admin/*` dan dijaga
oleh `RolesGuard` dengan `@Roles('HR_MANAGER', 'SUPER_ADMIN')`. Router `RolesGuard`
mengembalikan `403 FORBIDDEN` untuk role lain, bahkan tanpa memanggil service.

### 5.1 Hierarki Role & Prinsip Least Privilege

```
EMPLOYEE (0)  <  SUPERVISOR (10)  <  HR_MANAGER (20)  <  SUPER_ADMIN (30)
```

Dua fungsi murni di `apps/api/src/user/domain/role-hierarchy.ts` menegakkan
invariant berikut secara konsisten di service dan UI:

- **`canAssignRole(actor, target)`** — role yang boleh di-_create_/di-_promote_.
  - Actor harus rank ≥ `HR_MANAGER`.
  - Actor tidak boleh menetapkan role yang rank-nya di atas dirinya sendiri.
  - ⇒ `HR_MANAGER` tidak dapat membuat/promosi ke `SUPER_ADMIN`.
- **`canManageUser(actor, target)`** — apakah actor boleh me-_update_, _deactivate_, _reset password_ target.
  - Actor harus rank ≥ `HR_MANAGER`.
  - Rank target tidak boleh di atas actor. Sesama peer diperbolehkan (HR mengelola HR lain).

### 5.2 Department CRUD

```
POST   /admin/departments              → create (unique per company)
GET    /admin/departments              → list (+ userCount, parentName)
GET    /admin/departments/:id          → detail
PATCH  /admin/departments/:id          → rename / re-parent
DELETE /admin/departments/:id          → soft delete
```

Validasi wajib:

- Parent (jika ada) harus milik company yang sama, `deletedAt IS NULL`.
- Update: `parentId === id` → `DEPARTMENT_PARENT_CANNOT_BE_SELF`. Traversal parent
  mendeteksi cycle sebelum commit → `DEPARTMENT_CYCLE_DETECTED`.
- Delete: hanya diperbolehkan bila `_count.users` **dan** `_count.children` = 0.
  Jika salah satu > 0 → `DEPARTMENT_HAS_ACTIVE_USERS` / `DEPARTMENT_HAS_CHILDREN`.
- Setiap create/update/delete menulis `AuditLog` (`DEPARTMENT_CREATED / _UPDATED / _DELETED`) dalam transaksi yang sama.

### 5.3 User CRUD + Password Lifecycle

```
POST   /admin/users                     → create (auto-init LeaveBalance, temp password)
GET    /admin/users?...                 → list (search / role / departmentId / status / includeInactive)
GET    /admin/users/:id                 → detail
PATCH  /admin/users/:id                 → update (name, role, dept, supervisor, employmentStatus)
POST   /admin/users/:id/reset-password  → temp password + revokeAllForUser
DELETE /admin/users/:id                 → soft delete + terminate + revoke tokens
```

**Create flow (di dalam satu `$transaction`):**

1. `canAssignRole(actor.role, input.role)` → jika gagal: `403 ROLE_ASSIGNMENT_FORBIDDEN`.
2. Validasi `departmentId` dan `supervisorId` (jika ada) milik company yang sama.
   Supervisor harus punya role selain `EMPLOYEE`.
3. `generateTempPassword(14)` — crypto-secure, memuat huruf/angka/simbol,
   menghindari karakter ambigu `0/O/1/I/l`.
4. `argon2.hash(tempPassword)` (parameter di `PasswordService`).
5. Insert user, `LeaveBalance.createMany` untuk semua `LeaveType` aktif
   (year = current UTC year, `skipDuplicates: true`).
6. Insert `AuditLog(USER_CREATED)` — `passwordHash` di-strip sebelum di-serialize.

Response `{ user, temporaryPassword }` — password plaintext **hanya dikembalikan sekali**
di response ini. Setelah admin men-dismiss `CredentialReveal` di UI, tidak ada API
untuk mengambilnya kembali.

**Update flow:**

- `canManageUser(actor.role, existing.role)` → jika gagal: `403 CANNOT_MANAGE_HIGHER_ROLE`.
- Bila `input.role` berubah dan target === actor → `403 SELF_ROLE_CHANGE_FORBIDDEN`.
- Bila `input.employmentStatus !== ACTIVE` dan target === actor → `403 SELF_STATUS_CHANGE_FORBIDDEN`.
- `input.supervisorId === id` → `400 SUPERVISOR_CANNOT_BE_SELF`.
- `AuditLog(USER_UPDATED)` menyimpan `beforeJson`/`afterJson` (tanpa `passwordHash`).

**Reset password:**

1. `canManageUser` check.
2. Generate temp password + hash.
3. Update `passwordHash` di dalam transaksi + tulis `AuditLog(PASSWORD_RESET_BY_ADMIN)`.
4. **Setelah** commit: `TokenService.revokeAllForUser(id, 'PASSWORD_RESET_BY_ADMIN')`
   — semua refresh token user di-revoke sehingga sesi aktif ikut mati pada refresh berikutnya.
5. Return `{ user, temporaryPassword }` dengan disclosure yang sama seperti create.

**Deactivate:**

- Self-deactivate → `403 SELF_DEACTIVATE_FORBIDDEN` (mencegah admin mengunci diri sendiri).
- Soft delete (`deletedAt = now()`) + `employmentStatus = TERMINATED` + `AuditLog(USER_DEACTIVATED)` dalam satu transaksi.
- Setelah commit: `revokeAllForUser`.

### 5.4 Error Codes

| Code                                                             | HTTP | Kapan                                    |
| ---------------------------------------------------------------- | ---- | ---------------------------------------- |
| `ROLE_ASSIGNMENT_FORBIDDEN`                                      | 403  | HR mencoba menetapkan `SUPER_ADMIN`      |
| `CANNOT_MANAGE_HIGHER_ROLE`                                      | 403  | HR menyunting akun `SUPER_ADMIN`         |
| `SELF_ROLE_CHANGE_FORBIDDEN`                                     | 403  | Actor mengubah role sendiri              |
| `SELF_STATUS_CHANGE_FORBIDDEN`                                   | 403  | Actor set status non-ACTIVE pada dirinya |
| `SELF_DEACTIVATE_FORBIDDEN`                                      | 403  | Actor menonaktifkan dirinya              |
| `SUPERVISOR_CANNOT_BE_SELF`                                      | 400  | `supervisorId === id`                    |
| `SUPERVISOR_MUST_HAVE_LEAD_ROLE`                                 | 400  | Kandidat supervisor role = `EMPLOYEE`    |
| `SUPERVISOR_INVALID` / `DEPARTMENT_INVALID`                      | 400  | Reference cross-tenant / dihapus         |
| `EMAIL_ALREADY_TAKEN`                                            | 409  | Unique `(companyId, email)` violation    |
| `DEPARTMENT_NAME_TAKEN`                                          | 409  | Unique `(companyId, name)` violation     |
| `DEPARTMENT_HAS_ACTIVE_USERS` / `DEPARTMENT_HAS_CHILDREN`        | 409  | Delete guard                             |
| `DEPARTMENT_CYCLE_DETECTED` / `DEPARTMENT_PARENT_CANNOT_BE_SELF` | 400  | Parent invariant                         |
| `USER_NOT_FOUND` / `DEPARTMENT_NOT_FOUND`                        | 404  | Cross-tenant lookup                      |

## 5.5 Config Suite — Geofence, Shift, Leave Type, User-Shift Assignment

Semua endpoint di section ini di-guard oleh `@Roles('HR_MANAGER', 'SUPER_ADMIN')` dan
menulis `AuditLog` di dalam transaksi yang sama.

### 5.5.1 Geofence CRUD

```
POST   /admin/geofences               → create { name, latitude, longitude, radiusMeters }
GET    /admin/geofences               → list (+ shiftCount)
PATCH  /admin/geofences/:id           → update
DELETE /admin/geofences/:id           → soft delete
```

Aturan:

- `latitude ∈ [-90, 90]`, `longitude ∈ [-180, 180]` (dijaga oleh `class-validator`).
- `radiusMeters ∈ [5, 5000]` — batas atas mencegah "geofence seluruh kota".
- Delete guard: `_count.shifts > 0` (non-deleted) → `409 GEOFENCE_IN_USE_BY_SHIFT`. Lepas
  dulu geofence dari Shift terkait sebelum menghapus.
- Attendance historis tidak terpengaruh (nilai `distanceMeters` sudah didenormalisasi
  pada `AttendanceEvent`).

### 5.5.2 Shift CRUD

```
POST   /admin/shifts                  → create
GET    /admin/shifts                  → list (+ activeAssignments count)
PATCH  /admin/shifts/:id              → update
DELETE /admin/shifts/:id              → soft delete
```

Aturan:

- `startTime`, `endTime` dalam format `HH:mm` (`00:00`–`23:59`).
- `startTime === endTime` → `400 SHIFT_TIMES_INVALID` (durasi nol).
- Cross-midnight diperbolehkan: mis. `22:00 → 06:00` dihitung sebagai 8 jam
  (lihat `apps/api/src/shift/domain/hh-mm.ts` dan `shiftDurationMinutes`).
- `graceMinutes ∈ [0, 240]`.
- `geofenceId` (opsional) harus milik company yang sama dan `deletedAt IS NULL`; jika tidak → `400 GEOFENCE_INVALID`.
- Delete guard: `_count.assignments (active)` > 0 → `409 SHIFT_HAS_ACTIVE_ASSIGNMENTS`.
  "Active" = `deletedAt IS NULL AND (effectiveTo IS NULL OR effectiveTo >= now)`.
- Perubahan `startTime`/`endTime` tidak mengubah `AttendanceRecord` historis (denormalisasi).

### 5.5.3 User-Shift Assignment

```
POST   /admin/shifts/:shiftId/assignments      → assign
PATCH  /admin/shift-assignments/:id/end        → tutup rentang aktif dgn effectiveTo
DELETE /admin/shift-assignments/:id            → hard delete (hanya sebelum berlaku)
GET    /admin/users/:userId/shift-assignments  → riwayat + assignment aktif
```

Semantik:

- Rentang half-open `[effectiveFrom, effectiveTo)`; `effectiveTo = null` → open-ended.
- **Overlap detection**: assignment baru **tidak boleh** overlap dengan assignment lain
  milik user yang sama (lihat `shift-assignment-range.ts` — dipakai baik oleh service
  maupun oleh unit test). Overlap → `409 ASSIGNMENT_OVERLAP`.
- `effectiveTo < effectiveFrom` → `400 ASSIGNMENT_INVALID_RANGE`.
- `PATCH /end` hanya mengubah `effectiveTo`. Untuk mengganti shift, akhiri assignment
  lama lalu buat assignment baru.
- `DELETE` menolak assignment yang sudah mulai berlaku (`effectiveFrom <= today`) dengan
  `409 ASSIGNMENT_ALREADY_STARTED_USE_END` — pakai `PATCH /end` untuk menutup.

### 5.5.4 Leave Type CRUD + Balance Backfill

```
POST   /admin/leave-types             → create
GET    /admin/leave-types             → list (+ balanceCount)
PATCH  /admin/leave-types/:id         → update (kode tidak dapat diubah)
DELETE /admin/leave-types/:id         → soft delete
```

Aturan:

- `code` di-normalize ke UPPERCASE + regex `^[A-Z0-9_]{2,30}$`. Unik per company
  (`@@unique([companyId, code])`).
- **Auto-backfill** saat create: `LeaveBalance.createMany` untuk setiap `User`
  dengan `employmentStatus = ACTIVE` dan `deletedAt IS NULL`, tahun = current UTC year,
  `quota = defaultAnnualQuota`, `remaining = defaultAnnualQuota`, `skipDuplicates: true`.
  Tahun-tahun sebelumnya **tidak** di-backfill (skema akrual historis tidak boleh
  di-fabrikasi retroaktif).
- Update `defaultAnnualQuota` **tidak** meng-update balance yang sudah ada — hanya
  memengaruhi user baru / tahun berikutnya. Override manual balance diluar scope MVP.
- Delete guard: menolak jika ada `LeaveRequest` dengan status ∈
  `{PENDING_SUPERVISOR, PENDING_HR, APPROVED}` **dan** `endDate >= now`. Kode:
  `409 LEAVE_TYPE_HAS_OPEN_REQUESTS`. Balance historis dan request selesai tidak
  memblokir delete.

### 5.5.5 Error Codes (Config Suite)

| Code                                 | HTTP | Kapan                                                   |
| ------------------------------------ | ---- | ------------------------------------------------------- |
| `GEOFENCE_IN_USE_BY_SHIFT`           | 409  | Delete geofence yang masih dipakai Shift                |
| `GEOFENCE_INVALID`                   | 400  | Create/update Shift dgn geofence cross-tenant / dihapus |
| `GEOFENCE_NOT_FOUND`                 | 404  | Cross-tenant lookup                                     |
| `SHIFT_NAME_TAKEN`                   | 409  | Unique `(companyId, name)` violation                    |
| `SHIFT_TIMES_INVALID`                | 400  | `startTime === endTime`                                 |
| `SHIFT_HAS_ACTIVE_ASSIGNMENTS`       | 409  | Delete shift yang masih di-assign                       |
| `SHIFT_NOT_FOUND`                    | 404  | Cross-tenant lookup                                     |
| `USER_INVALID`                       | 400  | Assign shift ke user cross-tenant / dihapus             |
| `ASSIGNMENT_OVERLAP`                 | 409  | Rentang menabrak assignment lain user yang sama         |
| `ASSIGNMENT_INVALID_RANGE`           | 400  | `effectiveTo < effectiveFrom`                           |
| `ASSIGNMENT_ALREADY_STARTED_USE_END` | 409  | `DELETE` pada assignment yang sudah mulai               |
| `ASSIGNMENT_NOT_FOUND`               | 404  | Cross-tenant lookup                                     |
| `LEAVE_TYPE_CODE_TAKEN`              | 409  | Unique `(companyId, code)` violation                    |
| `LEAVE_TYPE_HAS_OPEN_REQUESTS`       | 409  | Delete tipe cuti dgn request aktif/mendatang            |
| `LEAVE_TYPE_NOT_FOUND`               | 404  | Cross-tenant lookup                                     |

## 5.6 Holiday Admin — Kalender Hari Libur

Digunakan oleh **mesin kalkulasi cuti** (`countBusinessDays` di
`apps/api/src/leave/domain/business-days.ts`) untuk mengecualikan hari libur nasional
dari perhitungan `days` saat submit cuti.

Guarded oleh `@Roles('HR_MANAGER', 'SUPER_ADMIN')`.

```
POST   /admin/holidays                → create { date, name }
POST   /admin/holidays/bulk           → bulk import [{date, name}, ...]
GET    /admin/holidays?year=2026      → list, ordered by date ASC
PATCH  /admin/holidays/:id            → rename / reschedule
DELETE /admin/holidays/:id            → hard delete
```

### Semantik

- Model `Holiday(companyId, date @db.Date, name)` dengan `@@unique([companyId, date])`.
  Insert duplikat → `409 HOLIDAY_DATE_TAKEN`. Hard delete (bukan soft delete) karena
  histori terjaga di `AuditLog`.
- Semua tanggal dinormalisasi ke **midnight UTC** (`YYYY-MM-DDT00:00:00.000Z`) untuk
  konsistensi dengan `leave.service.loadCompanyHolidayDates`.
- **Bulk import** menerima array `{date, name}` sampai 500 item. Semantik idempoten:
  - Duplikat di dalam payload di-dedupe secara lokal berdasarkan `date`.
  - Duplikat terhadap data yang sudah ada di DB → `skipDuplicates: true` (bukan error).
  - Response `{ inserted, skipped }` — memungkinkan admin memvalidasi hasil paste JSON.
- Semua create / update / delete / bulk menulis `AuditLog` (`HOLIDAY_CREATED /
_UPDATED / _DELETED / _BULK_IMPORTED`) dalam transaksi yang sama.

### Interaksi dengan permohonan cuti

- **Saat submit**: `LeaveService.submit()` memanggil `loadCompanyHolidayDates(companyId,
startDate, endDate)` dan meneruskan ke `countBusinessDays(start, end, {holidays})`
  yang mengeksklusi baik weekend (default Sat + Sun) maupun hari libur.
  Jika hasil `days === 0` → `400 ZERO_BUSINESS_DAYS`.
- **Snapshot semantics**: `days` disimpan di `LeaveRequest` **saat submit**. Menambah /
  menghapus / memindahkan hari libur setelahnya **tidak** mengubah `days` pada request
  yang sudah tersimpan. Ini disengaja — hari kerja saat pengajuan adalah kontrak
  antara karyawan dan sistem; retroactive changes akan merusak audit trail dan
  kepercayaan.
- Konsekuensi: jika hari libur nasional dirilis pemerintah **setelah** karyawan submit
  cuti mengelilingi tanggal tersebut, `days` yang dihitung akan lebih besar dari
  seharusnya. Karyawan bisa membatalkan (`POST /leave/:id/cancel`) lalu re-submit
  untuk mendapat perhitungan baru — atau HR override manual (di luar scope MVP).

### Error Codes (Holiday)

| Code                 | HTTP | Kapan                                     |
| -------------------- | ---- | ----------------------------------------- |
| `HOLIDAY_DATE_TAKEN` | 409  | Unique `(companyId, date)` violation      |
| `HOLIDAY_NOT_FOUND`  | 404  | Cross-tenant lookup atau id tidak dikenal |

## 5.7 Company Config Admin — Identitas & Kebijakan Lembur

Modul terakhir dalam Admin Suite: memungkinkan HR/Super Admin mengubah
konfigurasi tenant tanpa akses SQL. Sebelumnya semua 10 field di baris
`Company` (nama, timezone, tarif lembur, multiplier, cap, submit window,
grace scheduler) hanya dapat diubah lewat Prisma Studio / SQL — sekarang
tersedia UI self-service di `/admin/company`.

**Endpoints:**

```
GET   /api/v1/admin/company            → CompanyConfigDto
PATCH /api/v1/admin/company            → CompanyConfigDto (setelah update)
```

**Access control:** `HR_MANAGER` dan `SUPER_ADMIN`. Selalu di-scope ke
`actor.companyId` — tidak ada varian `/admin/companies/:id`. SUPER_ADMIN
tenant A **tidak dapat** melihat/mengubah tenant B melalui endpoint ini.
Ini konsisten dengan ADR-0002.

**Field yang dapat di-manage:**

| Field                       | Tipe           | Semantik                                                                                          |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `name`                      | string(1..120) | Nama tampilan. `slug` sengaja **tidak** dapat diubah karena berfungsi sebagai tenant identifier.  |
| `timezone`                  | IANA string    | Divalidasi domain-side dengan `Intl.DateTimeFormat`. Nama tidak dikenal → 400 `INVALID_TIMEZONE`. |
| `overtimeHourlyRate`        | Decimal(12,2)? | Boleh `null` untuk mewajibkan tarif per-karyawan.                                                 |
| `overtimeWeekdayMultiplier` | Decimal(4,2)   | Range `[1, 10]`. Minimum 1× — tidak boleh mengurangi upah.                                        |
| `overtimeWeekendMultiplier` | Decimal(4,2)   | Range `[1, 10]`.                                                                                  |
| `overtimeHolidayMultiplier` | Decimal(4,2)   | Range `[1, 10]`. Prioritas tertinggi di `classifyDay` (§4.2).                                     |
| `overtimeMaxHoursPerDay`    | Decimal(4,2)   | Range `(0, 24]`.                                                                                  |
| `overtimeSubmitWindowDays`  | Int            | Range `[1, 365]`.                                                                                 |
| `overtimeCompleteGraceDays` | Int            | Range `[0, 30]`. Lihat §4.6.                                                                      |

**PATCH semantics:**

- Semua field optional — omit = tidak berubah.
- `overtimeHourlyRate: null` **secara eksplisit** meng-clear tarif dasar
  (bukan sama dengan omit).
- Body kosong `{}` → 400 `EMPTY_UPDATE` (early rejection sebelum transaksi).

**Audit log:** setiap `PATCH` yang mengubah nilai menulis satu row
`AuditLog` di dalam transaksi yang sama:

```json
{
  "action": "COMPANY_CONFIG_UPDATED",
  "entityType": "Company",
  "entityId": "co-...",
  "beforeJson": { "overtimeHourlyRate": 50000, "overtimeCompleteGraceDays": 2 },
  "afterJson": { "overtimeHourlyRate": 75000, "overtimeCompleteGraceDays": 5 }
}
```

`beforeJson` dan `afterJson` **hanya memuat field yang benar-benar berubah**
(diff-shallow), sehingga replay idempoten (PATCH dengan nilai yang sama
dengan state saat ini) tidak menulis audit row sama sekali.

**UI (`/admin/company`):** dua section — Identitas &amp; Kebijakan Lembur — dengan
live preview biaya lembur 8 jam pada Weekday/Weekend/Holiday berdasarkan
tarif &amp; multiplier yang sedang di-fill (belum di-save). Membantu admin
memvisualisasikan dampak sebelum menyimpan. Tombol submit di-disable ketika
form belum dirty.

**Error Codes:**

| Code                                     | HTTP | Kapan                                                   |
| ---------------------------------------- | ---- | ------------------------------------------------------- |
| `EMPTY_UPDATE`                           | 400  | PATCH body `{}` atau tidak ada field yang di-recognize. |
| `INVALID_TIMEZONE`                       | 400  | Timezone bukan IANA yang dikenali runtime.              |
| `COMPANY_NOT_FOUND`                      | 404  | Tenant sudah soft-deleted atau id tidak match caller.   |
| Validation errors dari `class-validator` | 400  | Angka negatif, multiplier `< 1`, dsb.                   |

## 6. Pelaporan & Audit

### 6.1 Reports (Excel + PDF, streaming)

Semua endpoint di section ini di-guard oleh `@Roles('HR_MANAGER', 'SUPER_ADMIN')`
dan di-rate-limit ke **5 permintaan / menit** per klien via `@Throttle`.

```
POST /api/v1/reports/attendance
POST /api/v1/reports/leave-summary
POST /api/v1/reports/overtime-summary
```

Body memuat `format ∈ { xlsx | pdf }`. Response:

- `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` untuk xlsx
- `Content-Type: application/pdf` untuk pdf
- `Content-Disposition: attachment; filename="..."`
- `Cache-Control: no-store`
- Body = binary stream (bukan JSON) — FE menggunakan helper `reportsApi.*()` yang
  mengembalikan `{ blob, filename }` dan `saveBlob()` untuk trigger download.

**Pemisahan lapisan:**

```
apps/api/src/report/
├── domain/       ← pure row shaping (unit-tested, framework-free)
├── renderers/    ← thin exceljs / pdfkit adapters (stream ke NodeJS.Writable)
├── report.service.ts   ← query + orkestrasi
└── report.controller.ts ← set header, throttle, delegate ke service
```

Renderer **hanya** menerima array baris + summary + header info. Ini memisahkan
"apa yang dilaporkan" dari "bagaimana dirender" — menambah format baru (CSV, HTML)
tidak butuh perubahan query.

#### 6.1.1 Attendance Report

Body:

```json
{
  "format": "xlsx",
  "startDate": "2026-01-01",
  "endDate": "2026-01-31",
  "departmentId": null,
  "userIds": null
}
```

Aturan:

- `endDate < startDate` → `400 REPORT_RANGE_INVALID`.
- Window size cap:
  - `xlsx` → 366 hari.
  - `pdf` → 92 hari (rendering PDF dengan pdfkit paginated → menghindari OOM).
  - Melebihi → `400 REPORT_RANGE_TOO_LARGE:{format}:max={cap}:actual={days}`.
- `userIds` (max 500) diprioritaskan di atas `departmentId` bila keduanya diisi.
- Waktu (workDate, clockIn, clockOut) di-format di **timezone perusahaan**
  (`Company.timezone`, default `Asia/Jakarta`) — bukan UTC.
- Kolom output: Tanggal, Karyawan, Email, Departemen, Shift, Masuk, Keluar,
  Jam Kerja (2 desimal), Status, Telat (min), Pulang Cepat (min), Catatan.
- Footer: total baris, breakdown status (on-time / late / absent / cuti), Σ jam kerja,
  Σ menit telat.

#### 6.1.2 Leave Summary Report

Body:

```json
{ "format": "pdf", "year": 2026, "departmentId": null }
```

Aturan:

- Emit satu baris untuk **setiap** kombinasi (user × leave type) pada tahun target.
  User tanpa `LeaveBalance` untuk tipe cuti tertentu tetap muncul dengan kolom
  nol — memudahkan HR mendeteksi user yang lolos dari backfill.
- Kolom: Karyawan, Email, Departemen, Kode, Tipe Cuti, Tahun, Kuota, Carry-Over,
  Terpakai, Reserved, Sisa.
- Total footer: karyawan, tipe cuti, Σ kuota (kuota+carry), Σ terpakai, Σ reserved, Σ sisa.

#### 6.1.3 Overtime Summary Report

Body:

```json
{
  "format": "xlsx",
  "startDate": "2026-08-01",
  "endDate": "2026-08-31",
  "departmentId": null,
  "userIds": null,
  "statuses": ["APPROVED", "COMPLETED"]
}
```

Aturan:

- Sama seperti Attendance untuk window caps (366 hari xlsx / 92 hari pdf) +
  filter `departmentId` / `userIds` (max 500).
- **`statuses` default** = `['APPROVED', 'COMPLETED']` bila tidak diisi — ini
  adalah "payroll view", yaitu pengajuan yang boleh dibayar. Set eksplisit
  untuk menyertakan `PENDING_APPROVAL` / `REJECTED` / `CANCELLED` (audit mode).
- Renderer PDF memakai **A4 landscape** karena kolom kurensi tidak muat di
  portrait.
- Kolom output (xlsx lengkap; pdf ringkas):
  - Karyawan, Email, Departemen
  - Tanggal (workDate), Jenis (`WEEKDAY` / `WEEKEND` / `HOLIDAY` — dihitung
    ulang saat render dari `Holiday.date` window, tidak dari snapshot)
  - Jam, Tarif Dasar, Multiplier, Tarif/Jam, Total
  - Status, Disetujui/Ditolak (timestamp), Alasan
- Footer: pengajuan, karyawan (distinct), Σ jam + Σ total, plus breakdown
  jam & total per `dayKind` — kritis untuk verifikasi payroll (mis. deteksi
  klasifikasi weekend/holiday yang salah).

#### 6.1.4 Error Codes (Reports)

| Code                                              | HTTP | Kapan                      |
| ------------------------------------------------- | ---- | -------------------------- |
| `REPORT_RANGE_INVALID`                            | 400  | `endDate < startDate`      |
| `REPORT_RANGE_TOO_LARGE:{fmt}:max={n}:actual={n}` | 400  | Window melebihi cap format |
| `ThrottlerException: Too Many Requests`           | 429  | Melebihi 5 request / menit |

### 6.2 Audit Log

Query-only endpoint untuk HR Manager & Super Admin. Filter berdasarkan
`entityType`, `entityId`, `actorId`, rentang waktu. **Bukan bagian dari MVP awal.**

## 8. Attachment Upload (S3 Presigned URL)

Lampiran (surat dokter untuk cuti sakit, dsb.) diunggah **langsung dari FE ke
object storage** menggunakan presigned PUT URL. Backend tidak menyentuh byte
berkas — ia hanya menerbitkan URL bertanda tangan yang membatasi tipe, ukuran,
dan lokasi objek. Detail keputusan arsitektur ada di
[ADR-0004](./ADR/ADR-0004-attachment-strategy.md).

### 8.1 Alur Upload

```
FE                         Backend                       S3/MinIO
 │                            │                             │
 │─(1) POST /attachments/     │                             │
 │      presign               │                             │
 │      {purpose, contentType,│                             │
 │       sizeBytes, filename} │                             │
 │                            │─── auth + validate MIME     │
 │                            │    + validate size ≤ 5MiB   │
 │                            │─── mint key + sign PUT      │
 │◄─── {uploadUrl, fileKey,   │                             │
 │      requiredHeaders,      │                             │
 │      expiresIn}            │                             │
 │                                                          │
 │──(2) PUT uploadUrl (headers: Content-Type + Content-Length,  body: file bytes) ─►│
 │◄──── 200 OK ─────────────────────────────────────────────────────────────────────│
 │                            │                             │
 │─(3) POST /leave            │                             │
 │      {leaveTypeId, dates,  │                             │
 │       reason,              │                             │
 │       attachmentKey: fileKey}                            │
 │                            │─── verify key prefix        │
 │                            │    matches (companyId,      │
 │                            │             userId)         │
 │                            │─── save LeaveRequest        │
 │◄─── LeaveRequestDto        │                             │
 │                            │                             │
 │─(4) GET /leave/mine        │                             │
 │                            │─── for each row:            │
 │                            │    presign GET (1h TTL)     │
 │◄─── [...{attachmentUrl:    │                             │
 │      'https://s3?X-Amz-…'} ]                             │
```

### 8.2 Konstrain

| Aspek              | Nilai                                                                        | Diberlakukan di                                        |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| MIME whitelist     | `image/jpeg`, `image/png`, `image/webp`, `application/pdf`                   | Backend + FE                                           |
| Ukuran maks        | 5 MiB                                                                        | Backend (via signed `Content-Length`) + FE (pre-check) |
| Kunci path         | `attachments/leave-attachment/{companyId}/{userId}/{yyyy}/{mm}/{uuid}.{ext}` | Backend saja                                           |
| Presign PUT TTL    | 300 detik (5 menit)                                                          | `S3_PRESIGN_PUT_TTL_SECONDS`                           |
| Presign GET TTL    | 3600 detik (1 jam)                                                           | `S3_PRESIGN_GET_TTL_SECONDS`                           |
| Rate limit presign | 30 req/menit/user                                                            | `@Throttle` di controller                              |
| Bucket ACL         | Private (no public read)                                                     | Bootstrap MinIO / kebijakan bucket S3                  |

### 8.3 Kenapa key, bukan URL, yang disubmit?

FE menerima `fileKey` (opaque, mis. `attachments/leave-attachment/co-1/u-1/2026/08/…-pdf`)
dari presign response, lalu mengirim key itu — bukan URL — ke `POST /leave`.
Alasannya:

- Backend perlu **memvalidasi prefix** untuk mencegah user "curi" presign
  response user lain lalu meng-attach ke request-nya sendiri.
- URL bertanda tangan hanya valid singkat. Menyimpan URL di DB akan segera
  jadi mati; menyimpan key membuat pembacaan **selalu** memicu presign GET
  segar (TTL 1 jam). Klien tidak boleh cache `attachmentUrl` untuk waktu lama.

### 8.4 Snapshot Semantik & Retensi

- Kolom DB `LeaveRequest.attachmentUrl` menyimpan **key** (bukan URL). Nama
  kolom dipertahankan untuk kompatibilitas — dokumentasi + komentar kode
  menandakan semantik baru.
- Obyek yatim (presign berhasil, submit tidak): boleh dibersihkan oleh
  lifecycle rule S3 (`expire objects with prefix attachments/ after 30 days
if no reference`). Untuk MVP tidak ada job pembersih terjadwal — biaya
  dampak rendah pada volume yang diharapkan.
- Bila keputusan HR sudah `APPROVED`, lampiran dianggap **immutable
  record** — tidak boleh dihapus tanpa audit event `LEAVE_ATTACHMENT_DELETED`
  (future work).

### 8.5 Error Codes

| Code                       | HTTP | UI Copy (ID)                                          |
| -------------------------- | ---- | ----------------------------------------------------- |
| `CONTENT_TYPE_NOT_ALLOWED` | 400  | Tipe berkas tidak diizinkan (hanya JPG/PNG/WebP/PDF). |
| `FILE_TOO_LARGE`           | 400  | Berkas melebihi batas 5 MB.                           |
| `ATTACHMENT_KEY_INVALID`   | 400  | Lampiran tidak valid — silakan upload ulang.          |
| `STORAGE_NOT_CONFIGURED`   | 503  | Storage upload belum dikonfigurasi di server.         |

### 8.6 Dev Environment

MinIO otomatis di-boot lewat `docker compose up`. Bucket `workpulse` dibuat
oleh service `minio-init` (idempotent). UI console tersedia di
`http://localhost:9001` (login `workpulse` / `workpulse-secret`) untuk
inspeksi manual. Kredensial di `.env.example` sudah sinkron.

## 9. Notifications (in-app + email)

Sistem notifikasi terdiri dari dua kanal: **in-app** (bell di header
dashboard) dan **email** (adapter, saat ini `console` di dev). Kedua kanal
menerima payload identik yang di-generate oleh template pure di
`apps/api/src/notification/domain/templates.ts`.

### 9.1 Katalog Event

| `NotificationType`          | Trigger                                                               | Recipient             | Kanal          |
| --------------------------- | --------------------------------------------------------------------- | --------------------- | -------------- |
| `LEAVE_SUBMITTED`           | `LeaveService.submit`                                                 | Supervisor (jika ada) | in-app + email |
| `LEAVE_APPROVED_SUPERVISOR` | `LeaveService.decide` (APPROVE @ `PENDING_SUPERVISOR` → `PENDING_HR`) | Employee              | in-app + email |
| `LEAVE_APPROVED_HR`         | `LeaveService.decide` (APPROVE @ `PENDING_HR` → `APPROVED`)           | Employee              | in-app + email |
| `LEAVE_REJECTED`            | `LeaveService.decide` (REJECT di stage manapun)                       | Employee              | in-app + email |
| `OVERTIME_SUBMITTED`        | `OvertimeService.submit`                                              | Supervisor (jika ada) | in-app + email |
| `OVERTIME_APPROVED`         | `OvertimeService.decide` (APPROVE)                                    | Employee              | in-app + email |
| `OVERTIME_REJECTED`         | `OvertimeService.decide` (REJECT)                                     | Employee              | in-app + email |
| `OVERTIME_COMPLETED`        | `OvertimeCompletionService.runCompletion` → `promote()`               | Employee              | in-app + email |

`LEAVE_CANCELLED` dan `OVERTIME_CANCELLED` dicadangkan di enum tetapi belum
diintegrasikan — cancel adalah self-service (dilakukan oleh employee), jadi
notifikasi ke diri sendiri tidak perlu di MVP. Bisa ditambahkan nanti untuk
memberitahu supervisor bahwa antrean approvals mereka berkurang satu.

### 9.2 Semantics

- **Persistence.** Setiap event **selalu** menghasilkan satu row `Notification`
  per recipient — bahkan bila email gagal dikirim. In-app adalah source of
  truth; email adalah "best-effort delivery notice".
- **Atomicity.** Insert `Notification` masuk ke transaction yang sama dengan
  operasi bisnis (submit / decide). Jika bisnis-nya rollback, notifikasi
  ikut rollback. Kecuali untuk `OVERTIME_COMPLETED` — scheduler tidak pakai
  tx besar (per-row promote adalah tx kecilnya sendiri).
- **Email dispatch.** Dijadwalkan sebagai microtask segera setelah insert.
  Email adapter **tidak boleh melempar** — kegagalan SMTP di-log saja, tidak
  boleh membatalkan bisnis-nya.
- **Multi-tenant.** `companyId` disimpan per row. Semua query filter otomatis
  pada `recipientId` yang sudah terikat ke tenant lewat foreign key.

### 9.3 API

| Method | Path                                 | Deskripsi                                                         |
| ------ | ------------------------------------ | ----------------------------------------------------------------- |
| GET    | `/api/v1/notifications`              | List notifikasi caller (query: `unreadOnly=true`, `limit=1..100`) |
| GET    | `/api/v1/notifications/unread-count` | Angka untuk badge di bell                                         |
| POST   | `/api/v1/notifications/:id/read`     | Mark satu row sebagai read (idempotent)                           |
| POST   | `/api/v1/notifications/read-all`     | Mark semua unread milik caller sebagai read                       |

Semua endpoint hanya bisa memodifikasi row **milik caller** — API "lihat
notifikasi orang lain" **tidak** disediakan (privacy leak). Audit HR pakai
`AuditLog`, bukan endpoint ini.

### 9.4 Frontend (Bell)

`components/features/notifications/notification-bell.tsx` dimount di
`app/(dashboard)/layout.tsx`. Perilaku:

- Polling `unread-count` setiap 30 detik + saat window regain focus.
- Polling `list` hanya ketika dropdown terbuka.
- Optimistic mark-read (row jadi grey seketika, rollback bila API gagal).
- Deep link via `notification.data.href` (mis. `/leave/approvals`).
- Klik outside → tutup dropdown.

### 9.5 Email Transport

Dipilih via env `EMAIL_TRANSPORT`:

| Value      | Adapter                   | Kapan dipakai                                        |
| ---------- | ------------------------- | ---------------------------------------------------- |
| `console`  | `ConsoleEmailAdapter`     | Default. Log ke stdout dengan prefix `MAIL to=…`.    |
| `disabled` | `DisabledEmailAdapter`    | Test / E2E — silence total, tidak ada log.           |
| `smtp`     | (belum diimplementasikan) | Placeholder; saat ini fallback ke console + warning. |

Ketika SMTP mau di-enable secara real: install `nodemailer`, tambah
`SmtpEmailAdapter`, extend switch di `NotificationModule`. Env
`SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS` sudah
divalidasi di `envValidationSchema` menunggu implementasinya.

### 9.6 Retention

MVP tidak memiliki TTL. Row `Notification` tumbuh linear dengan aktivitas.
Untuk tenant sangat aktif, tambahkan cron `cleanup-old-notifications`
(hapus row `readAt IS NOT NULL AND createdAt < now - 90 days`). Ini
di-defer sampai ada tenant real yang menghasilkan >1M rows.

## 11. Timesheet (Fase 32a)

### 11.1 Tujuan

Konsolidasi harian atas kehadiran, lembur, cuti, absen, dan libur ke
dalam satu **snapshot per periode** per karyawan — sumber tunggal untuk
review HR dan input payroll.

### 11.2 Model data (materialised)

- `TimesheetConfig` (per tenant): `periodType` (WEEKLY / BIWEEKLY /
  MONTHLY / CUTOFF), `weekStartDay`, `biweeklyAnchor`, `cutoffDayOfMonth`
  (1..28), `timezone`. Lazily upserted saat pertama kali dibaca.
- `TimesheetPeriod` (per tenant × window): `periodStart..periodEnd`
  (inklusif), `label` (mis. "Aug 2026", "W32 2026", "26 Jul – 25 Aug").
  Unique per `(companyId, periodStart, periodEnd)`.
- `Timesheet` (per user × period): rollup `totalRegularHours`,
  `totalOvertimeHours`, `totalLeaveDays`, `totalAbsentDays`,
  `totalHolidays`, `totalWorkingDays`, `totalLateMinutes`,
  `totalEarlyLeaveMinutes`, plus `generatedAt`. Unique per
  `(userId, periodId)`.
- `TimesheetEntry` (per user × period × workDate): `kind` (WORKING /
  HOLIDAY / WEEKEND / LEAVE / ABSENT), `expectedHours`, `regularHours`,
  `overtimeHours`, `leaveHours`, `lateMinutes`, `earlyLeaveMinutes`,
  `sourceRefs` (JSON provenance dari source rows), `note`.

### 11.3 Endpoint

| Method + Path                    | Role            | Fungsi                                                                       |
| -------------------------------- | --------------- | ---------------------------------------------------------------------------- |
| `GET /admin/timesheet/config`    | HR, Super Admin | Baca konfigurasi                                                             |
| `PUT /admin/timesheet/config`    | HR, Super Admin | Update konfigurasi (validasi bounds + cross-field)                           |
| `POST /admin/timesheet/generate` | HR, Super Admin | Generate/regenerate periode berjalan (idempotent)                            |
| `GET /admin/timesheet/periods`   | Supervisor+     | Daftar periode yang sudah pernah di-generate                                 |
| `GET /admin/timesheet`           | Supervisor+     | Daftar timesheet per periode; supervisor otomatis di-scope ke direct reports |
| `GET /admin/timesheet/:id`       | Supervisor+     | Detail timesheet (entries + totals)                                          |
| `GET /me/timesheet/current`      | Semua           | Periode berjalan (rollup + entries) — `null` jika belum di-generate          |
| `GET /me/timesheet`              | Semua           | Riwayat 12 periode terakhir milik user                                       |
| `GET /me/timesheet/:id`          | Semua           | Detail timesheet milik user (403 bila milik orang lain)                      |

### 11.4 Generator flow

1. Load `TimesheetConfig` → hitung `(periodStart, periodEnd, label)`
   dengan `calculatePeriod()` (tz-aware, `Intl.DateTimeFormat`).
2. Upsert `TimesheetPeriod` (unique on window).
3. Untuk tiap user aktif:
   - Load AttendanceRecord + OvertimeRequest(APPROVED|COMPLETED) +
     LeaveRequest(APPROVED, overlapping) + AbsenceRecord + Holiday +
     UserShiftAssignment.
   - Loop tiap `workDate` dalam periode → `buildEntry()` (precedence:
     HOLIDAY > LEAVE > ATTENDANCE > ABSENT > WEEKEND > WORKING).
     Overtime selalu ditambahkan ke atas, apapun kind harinya.
   - Rollup ke totals via `rollupTimesheet()`.
   - Dalam satu transaksi Prisma: upsert `Timesheet`, `deleteMany`
     entries lama, `createMany` entries baru.

Idempotent: rerun untuk periode yang sama akan menggantikan `Timesheet`

- semua `TimesheetEntry` di dalamnya. Aman untuk dijalankan berulang
  kali (mis. setelah `AttendanceCorrection` diapprove di Fase 32b).

### 11.5 Frontend

- **User**: `/me/timesheet` — grid entries periode berjalan + 12
  riwayat terakhir.
- **HR / Supervisor**: `/admin/timesheet` — tabel `user × totals` untuk
  periode terpilih + tombol "Generate periode berjalan" (HR only).
- **HR**: `/admin/timesheet/config` — form konfigurasi period-type
  (adaptif: field `weekStartDay` / `biweeklyAnchor` / `cutoffDayOfMonth`
  muncul sesuai pilihan).

### 11.6 RBAC

- Employee → hanya timesheet sendiri (`/me/timesheet/*`).
- Supervisor → direct reports (via `user.supervisorId`).
- HR Manager & Super Admin → tenant-wide.
- Cross-tenant access dilindungi via `companyId` filter di setiap query
  dan `assertVisible` gate di `TimesheetService.getDetail`.

### 11.7 Payroll interaction (Fase 32c)

`payrollLockedUntil` (per company) sudah menjaga source rows tidak
bisa diedit setelah cutoff. Karena timesheet materialised, snapshot
tetap valid setelah lock. Fase 32c akan menambahkan CSV/XLSX export
dan `TimesheetExport` audit trail.

### 11.8 Non-goals fase 32a

- Submit / approve workflow — landing di **32b** (lihat §11.9–11.13).
- Payroll export — landing di **32c**.
- Rotating / flexible shift dukungan — 32a asumsi Mon–Fri fixed hours
  per shift (start–end).

### 11.9 Submission workflow (Fase 32b)

Mirror pola cuti: dua tier approval, notifikasi per event, audit log
per transisi.

```
DRAFT ──submit──▶ PENDING_SUPERVISOR ──approve──▶ PENDING_HR ──approve──▶ APPROVED
  ▲                    │                              │
  │                    └──reject──▶ REJECTED ◀──reject──┘
  │                                    │
  └────────────submit (re-submit)──────┘
```

Aturan aktor:

| Aksi                 | Aktor                                             |
| -------------------- | ------------------------------------------------- |
| `SUBMIT`             | Pemilik timesheet. Hanya dari `DRAFT`/`REJECTED`. |
| `SUPERVISOR_APPROVE` | Supervisor langsung, atau HR/Super Admin.         |
| `SUPERVISOR_REJECT`  | Sama; **wajib menyertakan alasan**.               |
| `HR_APPROVE`         | HR Manager / Super Admin.                         |
| `HR_REJECT`          | Sama; **wajib menyertakan alasan**.               |

Guard tambahan di layer service: submit ditolak (`409
TIMESHEET_PERIOD_NOT_ENDED`) bila `periodEnd > today` — mencegah
submit tengah periode.

### 11.10 Endpoint tambahan (Fase 32b)

| Method + Path                                    | Role            | Fungsi                                                              |
| ------------------------------------------------ | --------------- | ------------------------------------------------------------------- |
| `POST /me/timesheet/:id/submit`                  | Owner           | Submit ke supervisor. 409 kalau periode belum berakhir.             |
| `POST /admin/timesheet/:id/decide`               | Supervisor / HR | Approve atau reject; body `{ action, note? }`. Reject wajib `note`. |
| `GET /admin/timesheet?status=PENDING_SUPERVISOR` | Supervisor / HR | Queue view — filter status.                                         |

### 11.11 Auto-regenerate on AttendanceCorrection

Setelah `AttendanceCorrection` diapprove:

1. **Pre-commit** (dalam tx yang sama): `TimesheetService.assertCorrectionAllowed`
   menolak dengan `409 TIMESHEET_APPROVED_LOCK` bila timesheet untuk
   `workDate` sudah `APPROVED`. Race-safe terhadap HR-approve paralel.
2. **Post-commit** (fire-and-forget): `regenerateForCorrection` menghitung
   ulang entri user tersebut. Jika status sebelumnya `PENDING_SUPERVISOR`
   atau `PENDING_HR`, di-reset ke `DRAFT` (kolom keputusan di-clear) dan
   user mendapat notifikasi `TIMESHEET_REGENERATED` — supervisor / HR
   harus meninjau ulang.
3. HR bulk `Generate` **skip** user yang timesheet-nya sudah APPROVED;
   response menyertakan `timesheetsSkippedApproved`.

### 11.12 Break-time deduction

`Shift.breakMinutes` (int, default 0) dikurangkan dari
`regularHours` dan `expectedHours` saat generator berjalan:

```
regularHours   = max(0, (clockOut - clockIn)/3600s - shift.breakMinutes/60)
expectedHours  = max(0, (shiftEnd  - shiftStart)   - shift.breakMinutes) / 60
```

Clamp ke `0` mencegah misconfigured shift (mis. break > shift length)
mengeluarkan payroll negatif.

### 11.13 Notifikasi (Fase 32b)

Lima event baru pada enum `NotificationType`:

- `TIMESHEET_SUBMITTED` — ke supervisor saat karyawan submit.
- `TIMESHEET_APPROVED_SUPERVISOR` — ke karyawan setelah supervisor approve.
- `TIMESHEET_APPROVED_HR` — ke karyawan setelah HR seal (final).
- `TIMESHEET_REJECTED` — ke karyawan saat ditolak.
- `TIMESHEET_REGENERATED` — ke karyawan saat data diperbarui oleh
  koreksi yang di-approve.

### 11.14 Payroll export (Fase 32c)

HR mendownload timesheet **APPROVED** ke file CSV atau XLSX untuk
diserahkan ke sistem payroll eksternal. Setiap ekspor menulis satu
baris `TimesheetExport` sebagai audit trail append-only.

**Endpoint**

- `POST /api/v1/admin/timesheet/exports` — trigger export, streaming
  file kembali ke client. HR / SUPER_ADMIN. Throttle 10/min.
  - Body: `{ periodId, format: "CSV"|"XLSX", mode: "SUMMARY"|"DETAIL",
departmentId?, note? }`.
  - Response headers:
    - `Content-Type: text/csv; charset=utf-8` atau
      `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
    - `Content-Disposition: attachment; filename="payroll-<slug>-<mode>.<ext>"`.
    - `X-Payload-Sha256: <64-char hex>` — SHA-256 dari payload persis
      yang di-stream. Payroll bisa cocokkan dengan file yang mereka
      terima.
    - `X-Export-Id: <cuid>` — id baris `TimesheetExport`.
  - 400 `EXPORT_EMPTY` bila periode + filter tidak menghasilkan
    satu pun baris APPROVED. Ini defensive — payroll tidak boleh
    menerima file kosong.
- `GET /api/v1/admin/timesheet/exports?limit=50` — riwayat export
  50 baris terakhir, urut desc `createdAt`.

**Model data**

- `TimesheetExport` — table append-only. Migrasi menerbitkan
  `REVOKE UPDATE, DELETE ON TABLE "TimesheetExport" FROM PUBLIC`.
- Kolom penting:
  - `payloadSha256` — hex SHA-256, 64 char.
  - `rowCount` — jumlah `Timesheet` yang di-cover.
  - `entryCount` — jumlah `TimesheetEntry` untuk mode DETAIL, 0
    untuk SUMMARY.
  - `bytes` — panjang payload; verifikasi silang dengan hash.

**Format CSV**

- UTF-8 dengan BOM (`\uFEFF`) agar Excel Windows membuka encoding
  benar tanpa dialog.
- CRLF (`\r\n`) — RFC-4180 default.
- Field ber-`"`, `,`, CR, atau LF di-quote dengan escape `""`.
- Numbers unquoted; null → empty cell.
- Column order **beku** (lihat `payroll-rows.ts`). Menambah kolom
  hanya boleh di ujung — jangan reorder.

**Format XLSX**

- Satu worksheet: `Payroll — Summary` atau `Payroll — Detail`.
- Title block di baris 1–3 (nama perusahaan, periode + mode, timestamp +
  operator).
- Header row di baris 5, freeze di atasnya. Kolom numerik right-aligned.

**Mode kolom (ringkas)**

| Mode    | Kolom kunci                                                                                                                                                                                               |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SUMMARY | `employee_id`, `employee_name`, `department`, `period_*`, `working_days`, `regular_hours`, `overtime_hours`, `leave_days`, `absent_days`, `late_minutes`, `overtime_hourly_rate`, `overtime_pay_estimate` |
| DETAIL  | Semua kolom identitas + `work_date`, `entry_kind`, `expected_hours`, `regular_hours`, `overtime_hours`, `leave_hours`, `late_minutes`, `early_leave_minutes`, `note`                                      |

**Alur audit-first**

```
1. RBAC (HR / SUPER_ADMIN) → 403 kalau bukan.
2. Load Timesheet APPROVED (tenant + period + optional department).
3. Kalau 0 baris → 400 EXPORT_EMPTY.
4. Serialise ke Buffer.
5. Hitung SHA-256 payload.
6. INSERT TimesheetExport + AuditLog di TX yang sama.
7. Baru stream bytes ke client dengan header X-Payload-Sha256.
```

Kalau step 6 gagal, klien tidak menerima payload — invariant
"kami hanya bisa mengirim file yang tercatat pada audit trail".

**Payroll lock**

Fase 32c belum melock periode setelah ekspor. Concurrent-safety
sudah dijamin di Fase 32b:

- `AttendanceCorrection` menolak untuk hari yang jatuh di dalam
  `Timesheet` berstatus APPROVED (409 `TIMESHEET_APPROVED_LOCK`).
- HR "Generate periode berjalan" melewati baris APPROVED
  (`timesheetsSkippedApproved`).

Jadi payroll bisa **re-export** kapan saja — hasilnya deterministik
untuk periode yang sudah dikunci di-approval.

**UI**

- `/admin/timesheet/exports` — dua kolom: form export (kiri) + tabel
  audit trail (kanan) dengan preview 16-char pertama `payloadSha256`.
- Link "Export payroll" ditambahkan di header `/admin/timesheet`.

### 11.15 Signed download URL untuk export payroll (Fase 32d)

Selain mengirim file lewat email, HR bisa membuat link download yang
bisa dibuka **tanpa akun** oleh vendor payroll — link kadaluarsa 24 jam
(bisa diatur) dan bisa dicabut sewaktu-waktu.

**Endpoints**

| Method | Path                                                      | Access          | Deskripsi                                                                                     |
| ------ | --------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------- |
| POST   | `/admin/timesheet/exports/:id/shares`                     | HR, Super Admin | Buat link. Body: `{ ttlHours?, note? }`. Response: `{ id, url, expiresAt, note, createdAt }`. |
| GET    | `/admin/timesheet/exports/:id/shares`                     | HR, Super Admin | List link untuk satu export beserta `downloadCount`, `expiresAt`, `revokedAt`, dan `active`.  |
| POST   | `/admin/timesheet/exports/:id/shares/:shareId/revoke`     | HR, Super Admin | Revoke soft — link jadi 403 seketika. Idempotent.                                             |
| GET    | `/public/timesheet-exports/download?id&expires&signature` | Anonim          | Endpoint download tanpa JWT. Serve bytes yang persis sama dengan hasil export awal.           |

**Signature**

- `HMAC_SHA256(TIMESHEET_EXPORT_SIGNING_SECRET, "${shareId}:${expiresAtMs}")`
  di-encode base64url.
- Server melakukan `timingSafeEqual` untuk anti-timing-attack.
- Pengecekan `expiresAt` hanya jalan **setelah** signature valid, agar
  URL "signature valid tapi expired" tidak bisa dibedakan dari
  "signature invalid" berdasarkan waktu respons.
- **Semua** failure path (bad signature, malformed, revoked, mismatched
  expiry) mengembalikan 403 generik ke klien; alasan spesifik hanya
  ditulis di log server.

**Payload persistence**

- Kolom baru `TimesheetExport.payload` (`bytea`, nullable) menyimpan
  byte-string persis yang dibuat pada waktu export. Endpoint public
  serve kolom ini apa adanya (bukan re-render) supaya bytes vendor terima
  identik dengan yang dilihat HR — termasuk untuk XLSX yang non-deterministik.
- Cross-check integritas: `sha256(payload) === payloadSha256` sebelum
  dikirim. Kalau mismatch → 500 `EXPORT_PAYLOAD_CORRUPTED` (sinyal
  tampering di layer DB).
- Baris pre-32d tidak punya payload → refuse dengan 410
  `EXPORT_PAYLOAD_UNAVAILABLE` (HR perlu re-export).

**Rate limiting**

- Endpoint public di-throttle 60 hits/min per IP. Cukup untuk pola pakai
  normal (satu vendor tarik satu file), ketat untuk pola brute-force.

**Header response**

- `X-Payload-Sha256`: sama dengan `payloadSha256` audit row → vendor
  bisa `sha256sum` file lokal dan mencocokkan.
- `X-Export-Id`: ID audit row asli.
- `Cache-Control: no-store` — cegah proxy menyimpan payroll bytes.

**Audit events**

| Action                              | Actor             | Kapan                                                                         |
| ----------------------------------- | ----------------- | ----------------------------------------------------------------------------- |
| `TIMESHEET_EXPORT_SHARED`           | HR / Super Admin  | Setelah `POST /shares` sukses.                                                |
| `TIMESHEET_EXPORT_SHARE_REVOKED`    | HR / Super Admin  | Setelah revoke sukses.                                                        |
| `TIMESHEET_EXPORT_SHARE_DOWNLOADED` | **null** (anonim) | Setiap kali public endpoint sukses. IP requester tersimpan di `afterJson.ip`. |

**Rotasi secret**

- Rotasi `TIMESHEET_EXPORT_SIGNING_SECRET` **membatalkan** semua link
  yang sudah beredar seketika — itu memang mekanisme incident-response
  saat link bocor. Beri notifikasi ke HR sebelum rotasi.

**UI**

- Tabel audit trail di `/admin/timesheet/exports` sekarang punya kolom
  aksi **Bagikan** per baris. Klik → modal:
  1. Set TTL (1..168 jam, default 24), catatan opsional.
  2. Klik **Buat link** → URL muncul dengan tombol **Salin**.
  3. List link aktif untuk export tersebut dengan tombol **Cabut**.
- Vendor buka URL apa adanya di browser → file otomatis terdownload.

### 11.16 Outbound webhook untuk sistem vendor (Fase 32e)

Selain unduh manual + link berbagi, HR juga bisa mendaftarkan URL vendor
untuk menerima **push notification** setiap kali event terjadi. Vendor
memverifikasi otentik dengan HMAC-SHA256.

**Event set (Fase 32e)**

| Event                            | Kapan                       | Payload data                                                                                                                                   |
| -------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `timesheet.export.created`       | HR commit export payroll    | `exportId, periodId, periodLabel, periodStart, periodEnd, format, mode, rowCount, entryCount, bytes, payloadSha256, departmentId, requestedBy` |
| `timesheet.export.share.created` | HR mint signed download URL | `shareId, exportId, downloadUrl, expiresAt, note, createdBy`                                                                                   |

**Admin endpoints**

| Method | Path                                            | Deskripsi                                                         |
| ------ | ----------------------------------------------- | ----------------------------------------------------------------- |
| POST   | `/admin/webhooks`                               | Buat endpoint. Response 201 memuat `secret` — **hanya kali ini**. |
| GET    | `/admin/webhooks`                               | List endpoint tenant.                                             |
| PATCH  | `/admin/webhooks/:id`                           | Update URL / events / active.                                     |
| POST   | `/admin/webhooks/:id/rotate-secret`             | Rotasi secret. Response memuat plaintext baru sekali.             |
| POST   | `/admin/webhooks/:id/test-fire`                 | Kirim event sintetik ke endpoint (untuk verifikasi awal).         |
| DELETE | `/admin/webhooks/:id`                           | Hapus endpoint (kaskade ke delivery log).                         |
| GET    | `/admin/webhooks/deliveries?endpointId=&limit=` | Riwayat delivery 50 terbaru per endpoint.                         |

**Signature scheme**

- Header: `X-Workpulse-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256>`.
- Signed string: `` `${t}.${rawBody}` ``.
- Verifikasi vendor (contoh Node.js):
  ```js
  const [, t, v1] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(header) ?? [];
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) reject('stale');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex')))
    reject('bad signature');
  ```
- HMAC dihitung di sisi Workpulse pada **saat delivery** (bukan
  enqueue) — timestamp mengikuti waktu kirim aktual, jadi vendor
  boleh pakai toleransi ketat (5 menit) meski delivery masuk retry
  6-jam.

**Retry policy**

- Fixed schedule: **30s → 5m → 30m → 6h** (4 percobaan, dapat diubah
  via `WEBHOOK_MAX_ATTEMPTS`).
- Terminal `FAILED` setelah semua percobaan habis. HR bisa
  **Test-fire** ulang dari UI kalau vendor sudah pulih.
- Semua percobaan mencatat `attemptCount, lastResponseStatus,
lastResponseBodySnippet (512 byte), lastError` di `WebhookDelivery`.

**SSRF hardening**

- Endpoint URL divalidasi dua-fase (sintaks + DNS lookup) pada
  create-time DAN pada tiap delivery attempt (DNS rebinding defence).
- Ditolak: skema non-HTTP, `http://` di production, kredensial inline
  (`user:pass@`), host IP metadata cloud `169.254.169.254`, IP privat /
  loopback / link-local / ULA (`WEBHOOK_BLOCK_PRIVATE_IPS=true` — bisa
  di-opt-out untuk deployment on-prem).
- Worker `fetch` pakai `redirect: 'error'` — tidak ikuti 3xx.
- Timeout per-request `WEBHOOK_HTTP_TIMEOUT_MS` (default 10 s).

**Audit events**

| Action                            | Ketika                       |
| --------------------------------- | ---------------------------- |
| `WEBHOOK_ENDPOINT_CREATED`        | POST /admin/webhooks sukses. |
| `WEBHOOK_ENDPOINT_UPDATED`        | PATCH sukses.                |
| `WEBHOOK_ENDPOINT_SECRET_ROTATED` | Rotasi secret.               |
| `WEBHOOK_ENDPOINT_DELETED`        | DELETE sukses.               |

Delivery attempts sendiri **tidak** ditulis ke `AuditLog` — baris
`WebhookDelivery` sudah append-only (DB revoke DELETE) dan berperan
sebagai audit transport per-attempt.

**Rotasi secret**

- Rotasi hanya invalidasi verifikasi vendor untuk delivery **selanjutnya**.
- Rotasi tidak invalidasi baris log lama (baris menyimpan
  `signatureHeader` dari attempt terakhir yang sukses).

**UI**

- `/admin/webhooks` — bagi 2 kolom:
  - Kiri: form create + secret sekali-tampil.
  - Kanan: list endpoint (dengan tombol Test-fire, Rotasi, Aktif/Nonaktif,
    Hapus) + tabel delivery log auto-refresh 5 detik.

### 11.17 Auto-generate & reminder scheduler (Fase 32f)

Scheduler harian (`@Cron('0 0 3 * * *')`, disable via
`TIMESHEET_SCHEDULER_ENABLED=false`) menjalankan dua tugas per tenant:

**Auto-generate periode berikutnya.** Kalau `periodEnd` periode
terakhir sudah lewat, worker memanggil
`TimesheetService.generateForPeriod(now)`. Upsert-based, aman
di-tick berulang. Tenant baru yang belum punya periode langsung
mendapat periode pertama pada tick berikutnya.

**Reminder harian.** Untuk setiap timesheet yang masih perlu aksi:

| Status timesheet     | Recipient                                | Notification type             |
| -------------------- | ---------------------------------------- | ----------------------------- |
| `DRAFT` / `REJECTED` | pemilik timesheet                        | `TIMESHEET_SUBMIT_REMINDER`   |
| `PENDING_SUPERVISOR` | supervisor langsung                      | `TIMESHEET_APPROVAL_REMINDER` |
| `PENDING_HR`         | semua HR_MANAGER + SUPER_ADMIN di tenant | `TIMESHEET_APPROVAL_REMINDER` |

**Cadence tenant-configurable** via `TimesheetConfig`:

| Field                       | Range | Default | Arti                                                                     |
| --------------------------- | ----- | ------- | ------------------------------------------------------------------------ |
| `autoGenerateEnabled`       | bool  | true    | Master switch auto-gen.                                                  |
| `reminderEnabled`           | bool  | true    | Master switch reminder.                                                  |
| `submitReminderStartDays`   | 0..30 | 1       | Hari setelah `periodEnd` sebelum reminder pertama ke employee.           |
| `submitReminderMaxDays`     | 1..60 | 7       | Hari setelah `periodEnd` reminder berhenti (HR harus intervensi manual). |
| `approvalReminderStartDays` | 0..30 | 2       | Sama, untuk approver queue.                                              |
| `approvalReminderMaxDays`   | 1..60 | 14      | Sama, batas approver.                                                    |

Cross-field guard: `maxDays >= startDays` (DB `CHECK` + service).

**De-duplication.** Tabel `TimesheetReminderLog` dengan unique index
`(timesheetId, type, sentDate)` memastikan satu tenant hanya menerima
maksimal satu nudge per timesheet per hari — bahkan kalau worker
berjalan di beberapa replika sekaligus (concurrent `INSERT`
menghasilkan `P2002`, worker menganggap idempotent no-op). Tabel
adalah audit trail: `REVOKE UPDATE` di DB level; retention worker
membersihkan berdasarkan `RetentionPolicy.notificationRetentionDays`.

**RBAC & UI.** Field konfigurasi baru dikelola oleh HR/Super Admin
di `/admin/timesheet/config` (Fase 32a panel + fieldset baru). Setiap
perubahan meng-emit `AuditLog` `TIMESHEET_CONFIG_UPDATED` dengan
`afterJson` memuat seluruh state baru.

### 11.18 Reopen APPROVED timesheet (Fase 32g)

HR-Manager / Super Admin dapat membuka kembali timesheet yang sudah
`APPROVED` — misal karena rate OT direvisi setelah payroll rilis
atau kategori absen berubah setelah dokter menerbitkan surat lebih
lambat. Endpoint tunggal:

```
POST /api/v1/admin/timesheet/:id/reopen
Body: { "reason": "10..500 karakter" }
```

**Invariants (pure `validateReopen`):**

- Role harus `HR_MANAGER` atau `SUPER_ADMIN` → 403 `TIMESHEET_REOPEN_FORBIDDEN`.
- Status saat ini harus `APPROVED` → 409 `TIMESHEET_REOPEN_STATUS_INVALID`.
- `reason` wajib 10..500 karakter setelah trim → 400 `TIMESHEET_REOPEN_REASON_INVALID`.

**Efek atomik (`prisma.$transaction`):**

1. `Timesheet` reset ke `DRAFT`; kolom `submittedAt`, `supervisor*`,
   `hrManager*`, `rejected*` dibersihkan.
2. `reopenCount` dinaikkan; denorm `lastReopenedAt`, `lastReopenedById`,
   `lastReopenReason` diisi.
3. `AuditLog` `action='TIMESHEET_REOPENED'` dengan `beforeJson`
   memuat status + supervisor + HR provenance sebelum reset,
   `afterJson` memuat status baru + reason + count.
4. `Notification` dikirim ke pemilik + supervisor langsung dengan
   type `TIMESHEET_REOPENED`.

**Post-commit:** Webhook `timesheet.reopened` dienqueue via
`WebhookDispatcher.enqueue()`. `sourceId` = `reopen_{timesheetId}_{n}`
sehingga re-fire idempotent. Payload:

```jsonc
{
  "timesheetId": "...",
  "userId": "...",
  "periodId": "...",
  "periodLabel": "Januari 2026",
  "periodStart": "2026-01-01",
  "periodEnd": "2026-01-31",
  "reopenCount": 1,
  "reopenedAt": "2026-08-03T...",
  "reopenedBy": { "id": "...", "email": "hr@..." },
  "reason": "...",
}
```

Vendor payroll wajib membatalkan / hold pay item yang berkorespondensi
dan menunggu re-approval sebelum re-post.

**FE.** Panel `/admin/timesheet` menampilkan tombol "Buka kembali"
pada baris `APPROVED` untuk HR/Admin. Modal minta reason mandatory
(min 10 karakter). Row berikutnya menampilkan badge `Reopened ×N`
di kolom Status dengan tooltip berisi `lastReopenReason`.

**Sinyal data-quality.** `reopenCount > 3` per user per periode
mengindikasikan masalah scanner / assignment / rate. Tenant dapat
membuat report ad-hoc dengan filter tersebut untuk root-cause
analysis.

## 12. ROPA — Record of Processing Activities (Fase 31d)

### 12.1 Tujuan

Menyediakan register kegiatan pemrosesan data pribadi yang wajib
dipelihara oleh setiap tenant sesuai **UU 27/2022 PDP Pasal 31** dan
**GDPR Art. 30**. Regulator selalu meminta artefak ini pertama saat
inspeksi; sebelum Fase 31d tenant memelihara-nya di luar aplikasi
(spreadsheet) sehingga rentan drift dan tidak memiliki jejak audit.

### 12.2 Model data

- **`RopaActivity`** — 1 baris per aktivitas pemrosesan bernama; unik
  per `companyId + slug`. Menyimpan pointer `currentVersionId`
  (`@unique`) ke versi `PUBLISHED` yang berlaku.
- **`RopaActivityVersion`** — snapshot immutable per revisi. Semua
  field Art. 30 / Pasal 31 (`name`, `purpose`, `legalBasis`,
  `dataCategories`, `subjectCategories`, `recipients`,
  `retentionPeriod`, `crossBorderTransfer`, `crossBorderDetail`,
  `securityMeasures`, `notes`) melekat di sini.

### 12.3 Lifecycle

`DRAFT → REVIEW → PUBLISHED → ARCHIVED`, konsisten dengan
`PrivacyPolicy` (ADR-0022). Legal transitions:

- `DRAFT ⇄ REVIEW` — `submit-review` / `return-to-draft`.
- `REVIEW → PUBLISHED` — `publish`; sekaligus meng-`ARCHIVE` versi
  `PUBLISHED` sebelumnya dan meng-update `currentVersionId`
  dalam satu `$transaction`.
- `PUBLISHED → ARCHIVED` — implisit ketika versi baru publish; boleh
  eksplisit untuk withdrawal.

Hanya `DRAFT` yang dapat di-`PATCH`. Semua perubahan tercatat di
`AuditLog` (`ROPA_VERSION_CREATED / UPDATED / SUBMITTED / RETURNED /
PUBLISHED / ARCHIVED`).

### 12.4 Endpoint

| Method + Path                                                | Aksi                                           |
| ------------------------------------------------------------ | ---------------------------------------------- |
| `GET /admin/ropa/activities`                                 | List semua aktivitas + versi ringkas           |
| `GET /admin/ropa/activities/:id`                             | Detail (semua versi)                           |
| `POST /admin/ropa/activities`                                | Buat aktivitas baru + DRAFT v1                 |
| `POST /admin/ropa/seed-defaults`                             | Seed 6 blueprint bawaan (idempotent)           |
| `PATCH /admin/ropa/activities/:a/versions/:v`                | Edit DRAFT                                     |
| `POST /admin/ropa/activities/:a/versions/:v/submit-review`   | DRAFT → REVIEW                                 |
| `POST /admin/ropa/activities/:a/versions/:v/return-to-draft` | REVIEW → DRAFT                                 |
| `POST /admin/ropa/activities/:a/versions/:v/publish`         | REVIEW → PUBLISHED (+ archive previous)        |
| `POST /admin/ropa/activities/:a/new-version`                 | Fork DRAFT baru dari versi terakhir            |
| `GET /admin/ropa/export.pdf`                                 | Export PDF (regulator-facing)                  |
| `GET /admin/ropa/export.xlsx`                                | Export XLSX (frozen columns, machine-readable) |

Semua di-scope `companyId` di service; RBAC: `HR_MANAGER` +
`SUPER_ADMIN`. Rate-limit: mutations 30/menit, seed 5/menit, export
10/menit.

### 12.5 Seed catalogue

`POST /admin/ropa/seed-defaults` menghasilkan 6 blueprint DRAFT:

1. `attendance-tracking` — Kehadiran + geofence.
2. `leave-management` — Cuti + izin sakit + attachment surat dokter.
3. `overtime-management` — Lembur + perhitungan tarif.
4. `timesheet-and-payroll-export` — Rekapitulasi + export payroll.
5. `authentication-and-mfa` — Login + refresh token + TOTP.
6. `outbound-webhook-delivery` — Push event ke sistem eksternal.

Blueprint dibuat idempotent (slug unik `companyId+slug`), sehingga
klik ulang tombol adalah no-op untuk aktivitas yang sudah ada.

### 12.6 Export & tamper-evident audit

PDF menggunakan `pdfkit` (satu section per aktivitas). XLSX
menggunakan `exceljs` dengan **15 kolom frozen order** (lihat
`renderers/ropa-xlsx-renderer.ts`). Kedua format menerapkan
pola **audit-before-stream** (ADR-0025): SHA-256 dari payload di-hash
dan di-audit ke `AuditLog.afterJson.sha256` **sebelum** byte pertama
dikirim ke klien. Hash yang sama muncul di header response
`X-Payload-Sha256`, jadi DPO dapat mem-verifikasi PDF/XLSX yang
diterima auditor byte-perfect dengan baris audit.

### 12.7 FE

- `/admin/ropa` — panel list dengan status badge, tombol
  "Seed defaults", "Export PDF", "Export XLSX".
- `/admin/ropa/[activityId]` — detail semua versi + inline edit DRAFT
  - tombol submit-review / return-to-draft / publish / new-version.

### 12.8 Non-goals

- **Vendor / processor register terpisah** — di luar scope.
- **Auto-refresh saat product change** — masih manual; tenant wajib
  buka versi baru saat produk menambah kategori data / recipient
  baru.

### 12.9 DPIA — Data Protection Impact Assessment (Fase 31e)

Dilaksanakan ketika ROPA activity dinilai memiliki risiko tinggi bagi
subjek data (GDPR Art. 35 · UU 27/2022 PDP Pasal 34).

**Data model.**

- `DpiaAssessment` — satu per attempt: title, scope, necessity,
  dpoOpinion, conclusion, status, FK ke `RopaActivity`.
- `DpiaRiskItem` — banyak per assessment: title, description,
  likelihood, impact, inherentLevel, mitigations, residualLikelihood,
  residualImpact, residualLevel, ordinal.
- Enum `DpiaStatus`: `DRAFT → REVIEW → APPROVED → ARCHIVED`.
- Enum `DpiaRiskLevel`: `LOW | MEDIUM | HIGH | CRITICAL`.

**Scoring.** `likelihood × impact` → `[1..25]`:

| Score  | Level    |
| ------ | -------- |
| <8     | LOW      |
| 8..14  | MEDIUM   |
| 15..19 | HIGH     |
| 20..25 | CRITICAL |

Residual dihitung sama tetapi setelah mitigasi. **Residual ≤ inherent**
(DB CHECK + service guard).

**Lifecycle.**

1. `DRAFT` — editable.
2. `REVIEW` — frozen; harus return-to-draft untuk edit.
3. `APPROVED` — immutable; auto-archive APPROVED sebelumnya (partial
   unique index `one_approved_per_activity`).
4. `ARCHIVED` — historical.

Approve hanya legal dari `REVIEW` dan **wajib** ada ≥ 1 risk item.

**Endpoints (`HR_MANAGER`, `SUPER_ADMIN`).**

- `GET  /api/v1/admin/dpia/assessments` — list.
- `GET  /api/v1/admin/dpia/assessments/:id` — detail (with risk items).
- `POST /api/v1/admin/dpia/assessments` — create (DRAFT).
- `PATCH /api/v1/admin/dpia/assessments/:id` — edit (DRAFT-only).
- `POST /api/v1/admin/dpia/assessments/:id/submit-review`
- `POST /api/v1/admin/dpia/assessments/:id/return-to-draft`
- `POST /api/v1/admin/dpia/assessments/:id/approve`
- `POST /api/v1/admin/dpia/assessments/:id/risk-items`
- `PATCH /api/v1/admin/dpia/assessments/:id/risk-items/:riskItemId`
- `DELETE /api/v1/admin/dpia/assessments/:id/risk-items/:riskItemId`
- `GET  /api/v1/admin/dpia/assessments/:id/export.pdf` (10/min).

**Audit trail.** `DPIA_CREATED`, `DPIA_UPDATED`, `DPIA_SUBMIT_REVIEW`,
`DPIA_RETURN_TO_DRAFT`, `DPIA_APPROVE`, `DPIA_RISK_ADDED`,
`DPIA_RISK_UPDATED`, `DPIA_RISK_REMOVED`, `DPIA_EXPORTED`. Semua ditulis
di transaksi yang sama dengan mutasi.

**Frontend.**

- `/admin/dpia` — list-panel + detail-panel dua kolom. Form create
  memilih ROPA activity, form add-risk memvalidasi residual ≤ inherent
  di server.

**Non-goals.** XLSX export (deferred), per-tenant grid custom (5×5
ENISA cukup untuk semua tenant awal), bulk approve.

## 13. Analytics — Executive KPI Dashboard (Fase 33a)

### 13.1 Tujuan

Menyediakan satu halaman ringkas berisi metrik operasional utama
lintas modul (kehadiran, cuti, lembur, headcount) untuk HR + eksekutif.
Sebelum Fase 33a, HR harus merangkum manual dari beberapa laporan
CSV; setiap KPI baru berarti scan ulang tabel transaksional.

### 13.2 Model data

- **`AnalyticsSnapshot`** — 1 baris per `(companyId, date, metricKey)`.
  `value` disimpan sebagai `Decimal(18, 4)`. Kolom `dimension` JSONB
  disiapkan untuk slice per departemen / shift di fase berikut,
  namun rilis pertama hanya menulis roll-up tenant-wide (nilai
  `dimension = NULL`).
- **`AnalyticsMetricKey`** — enum di Prisma + shared-types. Sembilan
  KPI baseline:
  - `ATTENDANCE_ON_TIME_RATE` — fraksi 0..1
  - `ATTENDANCE_LATE_COUNT`, `ATTENDANCE_ABSENT_COUNT`
  - `LEAVE_PENDING_COUNT`, `LEAVE_DAYS_APPROVED`
  - `OVERTIME_HOURS`, `OVERTIME_COST_IDR`
  - `HEADCOUNT_ACTIVE`, `HEADCOUNT_TERMINATED`

### 13.3 Alur perhitungan

1. Cron **04:00 UTC** (`AnalyticsSnapshotWorker.tick`) memanggil
   `AnalyticsSnapshotService.snapshotAllTenants(now)`.
2. Per tenant: proyeksikan `now` ke `Company.timezone` → ambil
   "kemarin lokal" → hitung setiap KPI via
   `AnalyticsComputationService.compute(...)` → `upsert` ke
   `AnalyticsSnapshot`. Kegagalan satu tenant di-log, sweep lanjut.
3. Dashboard read (`GET /admin/analytics/dashboard`) membaca snapshot
   `[from, kemarin-lokal]` **plus** live-compute untuk hari ini.
   Kedua branch memakai `AnalyticsComputationService` yang sama
   sehingga tidak ada drift antara "kemarin materialised" dan "hari
   ini live".
4. Perbandingan periode-vs-periode: `previousWindow(w)` mengembalikan
   window abut yang tidak overlap; KPI tile menampilkan `delta`
   (absolut + persen + trend sesuai `direction` metrik).

### 13.4 Agregasi

- **SUM** — count / hours / currency (`ATTENDANCE_*_COUNT`,
  `LEAVE_DAYS_APPROVED`, `OVERTIME_HOURS`, `OVERTIME_COST_IDR`,
  `HEADCOUNT_TERMINATED`).
- **AVG** — hanya `ATTENDANCE_ON_TIME_RATE`; setiap hari sudah
  dinormalisasi ke fraksi, jadi rata-rata tidak berbobot memadai.
- **LAST** — `HEADCOUNT_ACTIVE`, `LEAVE_PENDING_COUNT` (point-in-time).

Pemetaan mode diputuskan di `AnalyticsQueryService.aggregationModeFor`
— FE tidak pernah memilih agregasi sendiri.

### 13.5 Endpoints

| Method | Path                                                   | RBAC                     | Throttle |
| ------ | ------------------------------------------------------ | ------------------------ | -------- |
| GET    | `/admin/analytics/dashboard?windowDays=7\|30\|90\|365` | HR_MANAGER / SUPER_ADMIN | 60/min   |
| GET    | `/admin/analytics/timeseries?metricKey=…&windowDays=…` | HR_MANAGER / SUPER_ADMIN | 60/min   |

### 13.6 Environment

| Env                          | Default | Purpose                                                |
| ---------------------------- | ------- | ------------------------------------------------------ |
| `ANALYTICS_SNAPSHOT_ENABLED` | `true`  | Kill switch worker (set `false` di follower replicas). |

### 13.7 FE

- `/admin/analytics` — landing untuk HR + admin. Window switcher
  7/30/90/365, grid 9 tile KPI, dan chart tren SVG (tanpa dep
  tambahan). Setiap tile clickable → memuat timeseries metrik itu.

### 13.8 Operasional

- **Backfill.** Metric baru butuh tick untuk hari-hari sebelumnya —
  dev / staging pakai `POST /test-support/analytics/backfill`, prod
  pakai skrip ops sementara (belum ada admin endpoint publik).
- **Retention.** Baris snapshot ~65 byte, ~3300 baris / tenant /
  tahun — belum ada TTL. Revisit jika tenant menyimpan lebih dari 5
  tahun tanpa purge.

### 13.9 Non-goals

- **Slice per departemen / shift** — reserved di `dimension` JSONB,
  belum diaktifkan di Fase 33a.
- **Warehouse (ClickHouse / DuckDB)** — belum diperlukan; revisit
  saat Fase 33b/c menambah metrik lebih dalam.
- **Alerting / anomaly detection** — di luar scope, akan hidup di
  Fase 33d.

## 14. Scheduled Email Reports (Fase 33c)

Distribusi otomatis PDF laporan ke recipient list (payroll, DPO, ops)
dengan cadence per-tenant.

**Data model.**

- `ReportSchedule` — subscription per tenant: `reportType` (enum),
  `frequency` (DAILY / WEEKLY / MONTHLY), `cadenceDay`, `cadenceHour`
  (UTC), `recipients[]` (max 20), `nextRunAt`, `active`.
- `ReportDelivery` — append-only log (REVOKE DELETE PUBLIC): status,
  attempts, `payloadSha256`, `payloadBytes`, `errorSnippet`.
- Enum `ScheduledReportType`: `TIMESHEET_SUMMARY | ROPA | DPIA |
ANALYTICS_SNAPSHOT | CUSTOM` (CUSTOM reserved untuk Fase 33b).
- Enum `ReportFrequency`: `DAILY | WEEKLY | MONTHLY`.
- Enum `ReportDeliveryStatus`: `PENDING | DISPATCHING | DELIVERED |
FAILED`.

**Cadence math.** Semua kalkulasi `nextRunAt` dilakukan di UTC. FE
picker mem-project jam lokal ke UTC sebelum submit. Domain fungsi
`advance()` dijamin monotonic: hasil selalu `> from`.

- DAILY — jam `cadenceHour`; roll ke besok kalau hari ini sudah lewat.
- WEEKLY — `cadenceDay ∈ [0..6]` (Sunday=0); wrap 7 hari kalau match.
- MONTHLY — `cadenceDay ∈ [1..28]` (menghindari ambiguitas bulan 30/31);
  roll ke bulan depan kalau tanggal sudah lewat.

**Worker.**

- Cron tiap 15 menit (`0 */15 * * * *`).
- Claim ≤20 schedule via `SELECT … FOR UPDATE SKIP LOCKED`; advance
  `nextRunAt` +15 menit sebagai hold-token supaya replika lain tidak
  double-claim saat rendering.
- Per-claim: render → SHA-256 → `EmailAdapter.send({ attachments })` →
  update `ReportDelivery` + tulis `AuditLog REPORT_DELIVERY_SENT`.
- Poison-pill (render throws / no recipients / CUSTOM tanpa handler)
  → FAILED delivery row, tidak blocking tetangga.

**EmailAdapter.** Interface diperluas dengan optional `attachments`
field — SMTP adapter meneruskan ke nodemailer; Console adapter log
metadata; Disabled adapter no-op. Backward-compat: template notifikasi
existing tidak set field ini.

**Endpoints (`HR_MANAGER`, `SUPER_ADMIN`).**

- `GET  /api/v1/admin/reports/registry` — daftar reportType + label.
- `GET  /api/v1/admin/reports/schedules`
- `POST /api/v1/admin/reports/schedules` (30/min)
- `PATCH /api/v1/admin/reports/schedules/:id` (60/min)
- `DELETE /api/v1/admin/reports/schedules/:id` (15/min)
- `GET  /api/v1/admin/reports/schedules/:id/deliveries`

**Environment.**

- `REPORT_SCHEDULER_ENABLED` — kill switch. Default `true`;
  follower replicas harus set `false`.

**Audit trail.** `REPORT_SCHEDULE_CREATED`, `REPORT_SCHEDULE_UPDATED`,
`REPORT_SCHEDULE_DELETED`, `REPORT_DELIVERY_SENT` (dari worker, tanpa
actor).

**Non-goals.**

- Preview PDF sebelum create schedule (deferred 33c.1).
- Signed-link alternatif attachment (deferred; timesheet share sudah
  meng-cover use case ini secara eksplisit).
- Custom reports — masuk Fase 33b via `SavedReport` handle.

## 15. Custom Report Builder (Fase 33b)

**Konteks.** HR / DPO butuh irisan data lintas dimensi tanpa lewat
engineering ticket. Free-form SQL ditolak (SQL injection + tenant
leakage), materialised view di-defer. Solusi: **catalogue-driven
declarative report**.

**Katalog tertutup.**

| Axis      | Nilai                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| Dimension | `DAY`, `DEPARTMENT`, `USER`                                                                                     |
| Metric    | `ATTENDANCE_COUNT`, `ATTENDANCE_LATE_COUNT`, `ATTENDANCE_ON_TIME_RATE`, `LEAVE_DAYS_APPROVED`, `OVERTIME_HOURS` |
| Window    | 7, 30, 90, 365 hari                                                                                             |

Setiap kombinasi = SQL fragment kurasi tim engineering, di-parametrise
via `Prisma.sql`. Tidak ada string concat user input.

**Data model.**

- `SavedReport` — tenant-scoped named report, unique per company by
  `name`. Field `definition` = JSONB (validated on every write + read
  that ends in execution).
- `createdById` nullable — tahan against erasure workflow (Fase 31b).

**Endpoints (`HR_MANAGER`, `SUPER_ADMIN`).**

- `GET  /api/v1/admin/reports/custom/catalogue` — dimensi + metric +
  window + descriptor.
- `POST /api/v1/admin/reports/custom/preview` — ad-hoc execute
  (throttled).
- `GET  /api/v1/admin/reports/custom/saved`
- `POST /api/v1/admin/reports/custom/saved`
- `PATCH /api/v1/admin/reports/custom/saved/:id`
- `DELETE /api/v1/admin/reports/custom/saved/:id`
- `GET  /api/v1/admin/reports/custom/saved/:id/export.csv`
- `GET  /api/v1/admin/reports/custom/saved/:id/export.xlsx`

**Export pattern.** Audit-before-stream — buffer → SHA-256 →
`AuditLog.create({ payloadSha256 })` → stream. Header
`X-Payload-Sha256` di-emit untuk verifikasi integritas.

**Integrasi dengan 33c.** `ScheduledReportType.CUSTOM` + `savedReportId`
→ scheduler tarik `definition`, execute, kirim CSV via
`EmailAdapter.send({ attachments })`. Definition di-validate ulang di
scheduler untuk defense-in-depth.

**Audit trail.** `SAVED_REPORT_CREATED`, `SAVED_REPORT_UPDATED`,
`SAVED_REPORT_DELETED`, `CUSTOM_REPORT_EXPORTED`.

**Non-goals.**

- Pivot / multi-metric agregat — deferred to third-party BI (Fase 34+).
- Ad-hoc chart preview di FE — CSV/XLSX dulu; visualisasi bisa di
  33a Analytics.
- Free-form filter di luar `departmentId` — sengaja disempit; tambahan
  filter butuh code change + review.

## 16. Breach Notification Ledger (Fase 31g)

**Konteks.** UU 27/2022 PDP Pasal 46 ayat (3) mewajibkan notifikasi
pelanggaran perlindungan data pribadi ke **Kominfo** dan **subjek
data** paling lambat **3 × 24 jam** sejak insiden diketahui. GDPR
Art. 33 (72 jam ke supervisory authority) meng-align. Sebelum 31g
hanya ada `AuditLog` — tidak regulator-friendly, tidak ada countdown
72 jam, dan tidak ada timeline tamper-evident.

**Data model.**

- `BreachIncident` — head record: `title`, `description`, `severity`
  (`LOW/MEDIUM/HIGH/CRITICAL`), `category` (`CONFIDENTIALITY/
INTEGRITY/AVAILABILITY/MIXED`), `status`, kronologi timestamps,
  impact (`affectedUserCount`, `affectedDataCategories[]`,
  `affectedSystems[]`), narrative (`containmentActions`, `rootCause`,
  `remediation`), notifikasi refs (`authorityNotificationRef`,
  `subjectNotificationTemplate`).
- `BreachTimelineEvent` — append-only event log, `REVOKE UPDATE,
DELETE ON PUBLIC` di DB level. Setiap mutation menulis event ini +
  `AuditLog` dalam satu `$transaction`.
- CHECK constraints: `occurredAt ≤ detectedAt`, `affectedUserCount ≥ 0`.

**State machine (forward-only).**

`DETECTED → CONTAINED → NOTIFIED_AUTHORITY → NOTIFIED_SUBJECTS → CLOSED`.
Escape hatch `CLOSE` dari DETECTED/CONTAINED/NOTIFIED_AUTHORITY
diperbolehkan hanya untuk `LOW` severity (verified no data-subject
risk). Rewind ditolak (`IllegalBreachTransitionError`); corrective
action lewat `NOTE_ADDED` timeline event.

**Deadline math (72 jam UU PDP).**

- Anchor: `detectedAt + 72h`, pure di `domain/deadline.ts`.
- Bucket: `SAFE > 24h`, `WARNING ≤ 24h`, `CRITICAL ≤ 4h`,
  `OVERDUE < 0`.
- Countdown aktif hanya di `DETECTED` / `CONTAINED` — sekali
  authority-notified, jam berhenti.

**Reminder worker (`BreachDeadlineWorker`).**

- Cron `0 */5 * * * *`.
- Scan incidents aktif → `bucketFor(hoursRemaining)`.
- Dedup via `BreachTimelineEvent(DEADLINE_WARNED, metadata.bucket)` —
  satu warning per bucket per incident.
- Fanout ke `assignedTo` + `reportedBy` + semua `HR_MANAGER` /
  `SUPER_ADMIN` tenant, via notification type baru
  `BREACH_DEADLINE_WARNING`.
- Kill switch: `BREACH_REMINDER_WORKER_ENABLED` (default `true`).

**Endpoints (`HR_MANAGER`, `SUPER_ADMIN`).**

- `GET  /api/v1/admin/security/breaches`
- `GET  /api/v1/admin/security/breaches/:id`
- `POST /api/v1/admin/security/breaches` (15/min)
- `PATCH /api/v1/admin/security/breaches/:id` (30/min)
- `POST /api/v1/admin/security/breaches/:id/mark-contained` (15/min)
- `POST /api/v1/admin/security/breaches/:id/notify-authority` (15/min)
- `POST /api/v1/admin/security/breaches/:id/notify-subjects` (15/min)
- `POST /api/v1/admin/security/breaches/:id/close` (15/min)
- `POST /api/v1/admin/security/breaches/:id/notes` (60/min)
- `GET  /api/v1/admin/security/breaches/:id/export.pdf` (10/min,
  audit-before-stream SHA-256 + `X-Payload-Sha256`)

**PDF regulator.** Buffered PDF via `pdfkit`, layout: metadata →
ringkasan → kronologi → tindakan → notifikasi → timeline. Sebelum
byte dikirim, `BREACH_EXPORTED` audit row + `EXPORTED` timeline event
di-commit dalam satu `$transaction`.

**Audit trail.** `BREACH_INCIDENT_CREATED`,
`BREACH_INCIDENT_UPDATED`, `BREACH_CONTAINED`,
`BREACH_NOTIFIED_AUTHORITY`, `BREACH_NOTIFIED_SUBJECTS`,
`BREACH_CLOSED`, `BREACH_NOTE_ADDED`, `BREACH_DEADLINE_WARNED`,
`BREACH_EXPORTED`.

**Non-goals.**

- Auto-populate dari `AuditLog` anomaly — deferred ke 33d (Anomaly
  Detection).
- Delivery real ke API Kominfo — API tidak public; ledger hanya
  mencatat referensi.
- Notifikasi subjek data via email adapter — template disimpan
  verbatim, delivery aktual out-of-band.

## 17. Retention Enforcement Audit (OPS-6)

Bukti otomatis bahwa `RetentionWorker` (§ ADR-0022) menjalankan
pruning sesuai `RetentionPolicy` per-tenant.

### Aktor

- **RetentionAuditWorker** (cron, tanggal 1 tiap bulan 05:30 UTC).
- **HR_MANAGER / SUPER_ADMIN** (baca laporan + regenerate manual).

### Alur bulanan

1. **Snapshot period**: worker menghitung window `[periodStart, periodEnd)`
   untuk bulan kalender sebelumnya (UTC).
2. **Aggregate audit rows**: hitung
   - `RETENTION_NOTIFICATIONS_PRUNED` — SUM `afterJson.deletedCount`.
   - `RETENTION_USER_AUTO_ANONYMIZED` — COUNT baris.
   - `DATA_EXPORT_EXPIRED` — COUNT baris.
3. **Probe gap** di tabel live:
   - `Notification.createdAt < now - retentionDays` masih ada.
   - `DataExportRequest.expiresAt < now AND fileKey IS NOT NULL`.
   - User TERMINATED > `terminatedUserAnonymizeDays` tanpa email
     `anonymised-*`.
4. **Derive status** via `deriveRetentionAudit()`:
   - `SUCCESS` → tidak ada temuan.
   - `GAP_DETECTED` → ada baris melewati batas retensi.
   - `WORKER_INACTIVE` → worker tidak tick sama sekali dan policy
     menuntut kerja (`notificationRetentionDays > 0` ATAU
     `terminatedUserAnonymizeDays > 0`).
5. **Upsert** `RetentionAuditReport` (unique `(companyId, periodStart)`).
6. **Notifikasi**: kalau bukan `SUCCESS`, dispatch
   `RETENTION_AUDIT_GAP_DETECTED` ke semua HR_MANAGER + SUPER_ADMIN
   tenant (in-app + email, honor preference).

### Regenerate manual

- Endpoint: `POST /api/v1/admin/privacy/retention/audit-reports/regenerate`
  body `{ year, month }`.
- **Tidak** mengirim notifikasi (biar tidak spam saat post-mortem).
- Reproducible: `policySnapshot` dibekukan di baris pertama, tapi
  regenerate MENIMPA policy snapshot dengan nilai kebijakan saat
  ini — audit ulang setelah policy fix menghasilkan angka baru
  yang konsisten dengan policy saat itu.

### Kill switch

- `RETENTION_AUDIT_WORKER_ENABLED` (default `true`).
- Set `false` pada replika follower supaya hanya primary yang tick.
- Health probe di `/api/v1/health/deep` mengekspos `workers.retentionAudit.enabled`.

### UI

- Daftar bulanan: `/admin/privacy/retention/audit-reports`.
- Detail satu bulan: `/admin/privacy/retention/audit-reports/[id]`.
- Timeline card dengan status chip + counter row + jumlah temuan.
- Detail: temuan per severity (`info` / `warning` / `critical`),
  side-by-side dengan snapshot kebijakan.

## 18. Tenant Usage Instrumentation (OPS-7)

Snapshot bulanan footprint per-tenant untuk perencanaan kapasitas
dan basis tier billing di masa depan.

### Aktor

- **TenantUsageWorker** (cron, tanggal 1 tiap bulan 06:00 UTC —
  30 menit setelah audit retention).
- **HR_MANAGER** (baca tenant sendiri).
- **SUPER_ADMIN** (baca cross-tenant + regenerate).

### Metrik

| Kategori   | Field                               | Sumber                                                             |
| ---------- | ----------------------------------- | ------------------------------------------------------------------ |
| Storage    | `storageExportBytes`                | `SUM(TimesheetExport.bytes)` di periode                            |
| Storage    | `storageDsarBytes`                  | `SUM(DataExportRequest.fileSize)` di periode                       |
| Storage    | `storageTotalBytes`                 | Sum keduanya (BigInt)                                              |
| Storage    | `attachmentBytesTracked`            | `false` — lampiran belum di-track (post-Beta)                      |
| DB rows    | `dbRowsUser`, `dbRowsAttendance`, … | `COUNT(*)` per tabel per tenant, point-in-time                     |
| DB rows    | `dbRowsTotal`                       | Sum semua tabel (BigInt)                                           |
| Komunikasi | `notificationsCreated`              | `COUNT(Notification)` di periode                                   |
| Komunikasi | `webhookDeliveries`                 | `COUNT(WebhookDelivery)` di periode                                |
| Populasi   | `activeUsers`                       | DISTINCT `userId` di attendance/leave/overtime/auditLog di periode |
| Populasi   | `totalUsers`                        | `COUNT(User WHERE deletedAt IS NULL)`                              |

### Alur bulanan

1. **Snapshot period**: `[periodStart, periodEnd)` untuk bulan
   kalender sebelumnya (UTC).
2. **Query paralel** semua 5 kategori metrik.
3. **Compute derived**: `storageTotalBytes = export + dsar`,
   `dbRowsTotal = SUM(per-table counts)` — enforced via pure functions
   di `usage-calculator.ts` supaya invariant selalu berlaku.
4. **Upsert** `TenantUsageSnapshot` (unique `(companyId, periodStart)`).

### Regenerate manual

- Endpoint: `POST /api/v1/admin/usage/regenerate` (SUPER_ADMIN)
  body `{ companyId, year, month }`.
- HR_MANAGER tidak bisa memicu regenerate — cross-tenant capability.

### Kill switch

- `TENANT_USAGE_WORKER_ENABLED` (default `true`).
- Set `false` pada replika follower.
- Health probe di `/api/v1/health/deep` mengekspos
  `workers.tenantUsage.enabled`.

### UI

- `/admin/usage` — HR_MANAGER melihat tabel snapshot bulanan tenant
  sendiri (kolom: periode, storage, DB rows, notif, webhook, active,
  total).
- SUPER_ADMIN melihat blok per-tenant dengan filter `companyId`,
  serta form regenerate.
- Lampiran dilabeli "Lampiran belum di-track" ketika
  `attachmentBytesTracked=false` — honest signal ke user.

### Precision

- Storage dan `dbRowsTotal` ditransport sebagai stringified integer
  (`"12345678"`) di response JSON supaya BigInt tidak silently
  terpotong di 2^53 pada tenant matang.

## 19. Vendor / Processor Register (Fase 31f)

Registry formal setiap pihak ketiga yang memproses data pribadi atas
nama tenant, memenuhi UU 27/2022 Pelindungan Data Pribadi Pasal 45
dan GDPR Art. 28.

### Model data

- `VendorProcessor` — satu baris per processor per tenant. Identitas
  (name, slug, category), footprint data (dataCategories, volume,
  residency), kontrak (start/end, dokumen URL, DPA signed date),
  siklus review (nextReviewAt, lastReviewedAt, lastReviewNote),
  lifecycle (status, terminatedAt, terminatedReason).
- `RopaActivityVendor` — join many-to-many antara `RopaActivity`
  dan `VendorProcessor`. Field `note` per link untuk anotasi lingkup
  ("processes salary field only").
- `VendorReminderLog` — dedup ledger append-only untuk worker
  reminder harian. Unique `(vendorId, kind, expectedFor)` memastikan
  siklus yang di-reschedule bisa memicu reminder baru.

### State machine

Enum `VendorStatus` mengikuti transisi forward-only yang dienforced
oleh `canTransition()`:

    UNDER_REVIEW  →  ACTIVE            (DPA ditandatangani)
    UNDER_REVIEW  →  TERMINATED        (negosiasi gagal)
    ACTIVE        →  DEPRECATED        (winding down)
    ACTIVE        →  TERMINATED        (kontrak berakhir clean)
    DEPRECATED    →  ACTIVE            (sunset dibatalkan)
    DEPRECATED    →  TERMINATED        (migrasi selesai)
    TERMINATED    →  (terminal)

`ACTIVE` juga mewajibkan `dpaSignedAt !== null` (`canBeActive`).
Vendor yang re-signed setelah terminasi HARUS membuat row baru
supaya jejak audit historis tidak tercemari.

### Aktor

- **HR_MANAGER** dan **SUPER_ADMIN** — CRUD, mark reviewed,
  terminate, tautkan/putus dari ROPA.
- **VendorReviewReminderWorker** (cron harian 07:00 UTC).

### Cadence reminder

Pure function di `vendor-review-cadence.ts`:

- `REVIEW_DUE` — `nextReviewAt <= now + 30d`. Severity naik ke
  `critical` begitu overdue.
- `CONTRACT_EXPIRING` — `contractEndAt <= now + 60d`. 60 hari
  dipilih karena siklus procurement Indonesia biasanya butuh 45+
  hari dari keputusan renewal ke PO baru.
- Vendor `TERMINATED` dan `DEPRECATED` tidak pernah memicu
  reminder.

### Alur harian worker

1. Load kandidat vendor (`status IN (ACTIVE, UNDER_REVIEW)` dan
   `nextReviewAt` atau `contractEndAt` <= now + 90d).
2. Untuk tiap vendor, hitung `computeDueReminders(now, …)`.
3. Untuk tiap reminder yang due, insert `VendorReminderLog` (unique
   dedup key `(vendorId, kind, expectedFor)`).
4. Bila insert sukses, dispatch in-app + email ke semua HR_MANAGER /
   SUPER_ADMIN tenant.
5. `P2002` pada insert = replika lain / tick sebelumnya sudah
   claim, silent skip.

### Kill switch

- `VENDOR_REVIEW_REMINDER_WORKER_ENABLED` (default `true`).
- Set `false` di replika follower.
- `/api/v1/health/deep` mengekspos `workers.vendorReviewReminder.enabled`.

### Audit trail

Setiap mutasi menulis `AuditLog` di transaksi yang sama:

- `VENDOR_PROCESSOR_CREATED`
- `VENDOR_PROCESSOR_UPDATED`
- `VENDOR_PROCESSOR_STATUS_CHANGED`
- `VENDOR_PROCESSOR_REVIEWED`
- `VENDOR_PROCESSOR_TERMINATED`
- `VENDOR_PROCESSOR_ROPA_LINKED`
- `VENDOR_PROCESSOR_ROPA_UNLINKED`

### UI

- `/admin/privacy/vendors` — daftar dengan filter status & kategori.
- `/admin/privacy/vendors/new` — form create (mulai `UNDER_REVIEW`).
- `/admin/privacy/vendors/[id]` — detail + action bar (mark reviewed,
  activate, deprecate, terminate) + panel ROPA links.
- Preferensi notifikasi mencakup dua toggle baru:
  `VENDOR_REVIEW_DUE` dan `VENDOR_CONTRACT_EXPIRING`.

## 7. Roles → Access Matrix (ringkas)

| Aksi                                  | EMPLOYEE | SUPERVISOR | HR_MANAGER | SUPER_ADMIN |
| ------------------------------------- | :------: | :--------: | :--------: | :---------: |
| Clock-in/out (own)                    |    ✓     |     ✓      |     ✓      |      ✓      |
| Lihat kehadiran tim                   |          |     ✓      |     ✓      |      ✓      |
| Submit cuti (own)                     |    ✓     |     ✓      |     ✓      |      ✓      |
| Approve cuti level 1 (supervisor tim) |          |     ✓      |            |      ✓      |
| Approve cuti level 2 (HR)             |          |            |     ✓      |      ✓      |
| Submit lembur (own)                   |    ✓     |     ✓      |     ✓      |      ✓      |
| Approve lembur (supervisor tim)       |          |     ✓      |            |      ✓      |
| Approve lembur (tenant-wide)          |          |            |     ✓      |      ✓      |
| Override saldo                        |          |            |     ✓      |      ✓      |
| CRUD Department                       |          |            |     ✓      |      ✓      |
| CRUD User (rank ≤ actor)              |          |            |     ✓      |      ✓      |
| Create SUPER_ADMIN                    |          |            |            |      ✓      |
| Reset password admin-issued           |          |            |     ✓      |      ✓      |
| CRUD Geofence / Shift / Leave Type    |          |            |     ✓      |      ✓      |
| Assign Shift ke user                  |          |            |     ✓      |      ✓      |
| CRUD Holiday (kalender libur)         |          |            |     ✓      |      ✓      |
| Export report                         |          |            |     ✓      |      ✓      |
| Lihat audit log                       |          |            |     ✓      |      ✓      |
| Reopen APPROVED timesheet             |          |            |     ✓      |      ✓      |
| Kelola ROPA registry                  |          |            |     ✓      |      ✓      |
| Publish versi ROPA                    |          |            |     ✓      |      ✓      |
| Export ROPA (PDF / XLSX)              |          |            |     ✓      |      ✓      |
| Lihat executive KPI dashboard         |          |            |     ✓      |      ✓      |
| Lihat timeseries analytics            |          |            |     ✓      |      ✓      |
| Lihat Retention Audit bulanan         |          |            |     ✓      |      ✓      |
| Regenerate Retention Audit            |          |            |     ✓      |      ✓      |
| Lihat usage tenant sendiri            |          |            |     ✓      |      ✓      |
| Lihat usage cross-tenant              |          |            |            |      ✓      |
| Regenerate usage snapshot             |          |            |            |      ✓      |
| CRUD Vendor / Processor Register      |          |            |     ✓      |      ✓      |
| Mark reviewed / Terminate vendor      |          |            |     ✓      |      ✓      |
| Tautkan vendor ke ROPA activity       |          |            |     ✓      |      ✓      |
