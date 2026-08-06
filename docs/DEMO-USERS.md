# Demo Users — Kredensial & Skenario Coverage

Referensi user demo yang di-seed ke database lokal / staging untuk keperluan
demo, UAT, dan E2E testing. **JANGAN pakai di production.**

- **Password (semua user):** `password123`
- **Company:** `Acme Indonesia` (tenant tunggal)
- **Sumber data:**
  - Baseline (4 user): [`apps/api/prisma/seed.ts`](../apps/api/prisma/seed.ts) — `pnpm db:seed`
  - UAT (28+ user, 5 departemen): [`apps/api/prisma/seed-uat.ts`](../apps/api/prisma/seed-uat.ts) — `pnpm db:seed:uat`

Kalau perlu me-refresh state ke fresh baseline: `pnpm db:migrate:reset && pnpm db:seed:uat` (⚠️ hapus semua data DB lokal).

---

## 1. User baseline (`pnpm db:seed`)

Empat user minimum untuk mencoba tiap role. Dipakai baseline oleh E2E suite
(`apps/e2e/tests/fixtures/users.ts`).

| Email                | Password      | Nama         | Role        | Department  | Kegunaan utama                                              |
| -------------------- | ------------- | ------------ | ----------- | ----------- | ----------------------------------------------------------- |
| `admin@acme.test`    | `password123` | Super Admin  | SUPER_ADMIN | Engineering | Cross-tenant admin, scanner trigger, override cutoff.       |
| `hr@acme.test`       | `password123` | HR Manager   | HR_MANAGER  | Engineering | Approval level-2, dashboard company-wide, audit log viewer. |
| `lead@acme.test`     | `password123` | Team Lead    | SUPERVISOR  | Engineering | Approval level-1, roster tim, koreksi absen.                |
| `employee@acme.test` | `password123` | Employee One | EMPLOYEE    | Engineering | Clock in/out, ajukan cuti/OT, timesheet.                    |

### 1.1 Login cepat

```bash
# via CLI (HTTPie)
http POST :4000/api/v1/auth/login email=hr@acme.test password=password123

# via browser
open http://localhost:3000/login
```

---

## 2. User UAT lengkap (`pnpm db:seed:uat`)

Setelah `pnpm db:seed:uat`, database populated dengan **28 karyawan + 3 edge
users**, tersebar di **5 departemen**, plus fixture historical (attendance
90 hari, cuti approved/pending, OT backlog, timesheet SUBMITTED, konsen
kadaluarsa, MFA-enabled user, audit log sample, notifikasi unread).

### 2.1 HR & Supervisor

| Email                      | Nama           | Role       | Department       | Catatan                                                        |
| -------------------------- | -------------- | ---------- | ---------------- | -------------------------------------------------------------- |
| `hr@acme.test`             | HR Manager     | HR_MANAGER | Engineering      | Base seed — HR utama.                                          |
| `hr2@acme.test`            | Rina Kartika   | HR_MANAGER | People & Culture | **MFA-enabled**. Login butuh OTP dari authenticator. Lihat §3. |
| `lead@acme.test`           | Team Lead      | SUPERVISOR | Engineering      | Supervisor Engineering.                                        |
| `budi.finance@acme.test`   | Budi Santoso   | SUPERVISOR | Finance          | Supervisor Finance (5 anggota tim).                            |
| `dewi.marketing@acme.test` | Dewi Anggraini | SUPERVISOR | Marketing        | Supervisor Marketing (5 anggota + 1 terminated).               |
| `agus.ops@acme.test`       | Agus Wibowo    | SUPERVISOR | Operations       | Supervisor Operations (6 anggota, mixed shift).                |
| `sinta.hr@acme.test`       | Sinta Wijaya   | SUPERVISOR | People & Culture | Supervisor People & Culture (2 anggota).                       |

### 2.2 Karyawan Engineering (5, supervisor: `lead@acme.test`)

| Email                 | Nama              | Hired      | Catatan                                                  |
| --------------------- | ----------------- | ---------- | -------------------------------------------------------- |
| `siti.eng@acme.test`  | Siti Nurhaliza    | 2024-01-08 | Pending leave request; OT approved; correction approved. |
| `andi.eng@acme.test`  | Andi Prasetyo     | 2024-02-14 | 90 hari attendance history.                              |
| `tono.eng@acme.test`  | Tono Hermawan     | 2024-03-20 | —                                                        |
| `sri.eng@acme.test`   | Sri Rahayu        | 2025-05-02 | —                                                        |
| `indah.eng@acme.test` | Indah Permatasari | 2025-08-15 | —                                                        |

### 2.3 Karyawan Finance (5, supervisor: `budi.finance@acme.test`)

| Email                  | Nama              | Hired      | Catatan             |
| ---------------------- | ----------------- | ---------- | ------------------- |
| `rio.fin@acme.test`    | Rio Setiawan      | 2023-11-05 | —                   |
| `maya.fin@acme.test`   | Maya Puspita      | 2024-04-11 | —                   |
| `hendra.fin@acme.test` | Hendra Kusuma     | 2024-07-22 | Backlog OT overdue. |
| `putri.fin@acme.test`  | Putri Ayu Lestari | 2025-01-16 | —                   |
| `dimas.fin@acme.test`  | Dimas Aditya      | 2025-09-01 | —                   |

### 2.4 Karyawan Marketing (5, supervisor: `dewi.marketing@acme.test`)

| Email                 | Nama            | Hired      | Catatan                     |
| --------------------- | --------------- | ---------- | --------------------------- |
| `lina.mkt@acme.test`  | Lina Marlina    | 2023-09-14 | 90 hari attendance history. |
| `bagus.mkt@acme.test` | Bagus Pratama   | 2024-05-30 | 90 hari attendance history. |
| `retno.mkt@acme.test` | Retno Widyawati | 2024-08-19 | —                           |
| `joko.mkt@acme.test`  | Joko Susilo     | 2025-02-24 | —                           |
| `ayu.mkt@acme.test`   | Ayu Wandira     | 2025-11-07 | —                           |

### 2.5 Karyawan Operations (6, supervisor: `agus.ops@acme.test`, mixed shift)

| Email                 | Nama            | Hired      | Catatan                                               |
| --------------------- | --------------- | ---------- | ----------------------------------------------------- |
| `reza.ops@acme.test`  | Reza Firmansyah | 2023-03-06 | Cuti ANNUAL 90 hari lalu; 90 hari attendance history. |
| `dian.ops@acme.test`  | Dian Sastro     | 2023-08-21 | Overtime request slot.                                |
| `arief.ops@acme.test` | Arief Budiman   | 2024-01-14 | —                                                     |
| `nur.ops@acme.test`   | Nur Aisyah      | 2024-06-05 | —                                                     |
| `iqbal.ops@acme.test` | Iqbal Rahman    | 2025-03-19 | —                                                     |
| `tia.ops@acme.test`   | Tia Ramadhani   | 2025-10-04 | —                                                     |

### 2.6 Karyawan People & Culture (2, supervisor: `sinta.hr@acme.test`)

| Email                | Nama           | Hired      | Catatan |
| -------------------- | -------------- | ---------- | ------- |
| `eka.hr@acme.test`   | Eka Puspa Sari | 2024-01-22 | —       |
| `farah.hr@acme.test` | Farah Diba     | 2025-03-10 | —       |

### 2.7 Edge users (3)

Skenario khusus untuk uji jalur-jalur non-happy-path.

| Email                  | Nama              | Role     | Status               | Skenario                                                          |
| ---------------------- | ----------------- | -------- | -------------------- | ----------------------------------------------------------------- |
| `newbie.eng@acme.test` | Newbie Onboarding | EMPLOYEE | ACTIVE               | `mustChangePassword=true` — login pertama dipaksa ganti password. |
| `mira.eng@acme.test`   | Mira Mahatma      | EMPLOYEE | ON_LEAVE (maternity) | Masih di-payroll; tidak muncul di roster harian.                  |
| `exit.mkt@acme.test`   | Exit Employee     | EMPLOYEE | TERMINATED           | Soft-deleted; tidak muncul di `/admin/karyawan` default.          |

---

## 3. MFA-enabled user — `hr2@acme.test`

User `hr2@acme.test` sudah **enroll TOTP** oleh seed sehingga login-nya
memvalidasi OTP dari authenticator app (Google Authenticator, Authy,
1Password, Microsoft Authenticator, dsb.).

### 3.1 Alur login

1. `POST /auth/login` dengan `email=hr2@acme.test&password=password123` →
   response `403 MFA_REQUIRED` + `challengeToken`.
2. Buka authenticator app; kode 6-digit refresh tiap 30 detik.
3. `POST /auth/mfa/verify` dengan `{ challengeToken, code: "123456" }` →
   access token + refresh cookie diterbitkan.

Di browser: setelah submit password, `/login/mfa` menampilkan input OTP.

### 3.2 Cara enroll authenticator (localhost)

Seed men-encrypt secret TOTP-nya di database. Untuk mengambil secret plaintext
supaya bisa di-scan authenticator, jalankan:

```bash
pnpm --filter @workpulse/api exec ts-node -e "
  import { PrismaClient } from '@prisma/client';
  import { decodeEncryptionKey, decryptString } from './src/auth/mfa/domain/crypto';
  const prisma = new PrismaClient();
  const key = decodeEncryptionKey(process.env.MFA_SECRET_ENCRYPTION_KEY!);
  const u = await prisma.user.findFirst({ where: { email: 'hr2@acme.test' } });
  console.log('otpauth://totp/Workpulse:hr2@acme.test?secret=' + decryptString(u.mfaSecret!, key) + '&issuer=Workpulse');
"
```

Copy hasil URL → paste ke authenticator app (biasanya menu "Add account →
Manual entry" atau langsung scan QR yang di-render dari URL).

Alternatif: reset user via `/settings/security/mfa` UI, lalu enroll ulang
dari zero.

### 3.3 Backup codes

Seed juga issue 8 backup code — dapatkan via `GET /auth/mfa/backup-codes` setelah login sukses.

---

## 4. Consent-expired cohort

Sekitar 29 user (non-kanonik) sengaja **tidak** di-accept ke privacy policy
V2, sehingga saat login akan redirect ke `/consent` dan diblok
`ConsentAcceptedGuard` untuk semua route lain.

**Cohort yang consent V2 diterima (bebas consent gate):**

- `admin@acme.test`, `hr@acme.test`, `lead@acme.test`, `employee@acme.test`,
  `hr2@acme.test`, dan beberapa lain — cek konstanta `CONSENTED_TO_V2` di
  [`seed-uat.ts`](../apps/api/prisma/seed-uat.ts).

**Sisanya:** login → dipaksa buka `/consent` → klik "Setuju" → baru bisa
lanjut. Skenario ini menguji `ConsentAcceptedGuard`. Detail:
[ADR-0022](./ADR/ADR-0022-retention-and-consent.md).

---

## 5. Fixture historical (auto-generated saat seed)

Seed UAT juga membuat:

| Fixture                        | Deskripsi                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| Attendance 90 hari             | Untuk 5 user tertentu — jam masuk/pulang random dalam window shift.                       |
| Cuti historis + pending        | Beberapa `LeaveRequest` dengan status APPROVED / PENDING_HR / REJECTED.                   |
| Overtime historis + pending    | `OvertimeRequest` di berbagai state; ada yang **backlog overdue** (stale > 3 hari kerja). |
| Attendance correction          | `siti.eng@acme.test` punya 1 correction APPROVED.                                         |
| Timesheet SUBMITTED bulan lalu | Untuk sekitar 10 user — siap di-approve di `/admin/timesheet`.                            |
| Privacy Policy V1 & V2         | V2 aktif; V1 archived. Consent user di-fork sesuai cohort di atas.                        |
| Audit log entries              | Sample events (login, approval, override) untuk viewer `/admin/audit-log`.                |
| Unread notifications           | 5–10 per user aktif — populate inbox bell counter.                                        |

Idempotent — jalankan `pnpm db:seed:uat` berkali-kali menghasilkan state
DB yang sama (idempotent by design, lihat header komentar di file seed).

---

## 6. Skenario UAT — dari mana mulai?

Alur end-to-end lengkap ada di [UAT-E2E.md](./UAT-E2E.md). Peta cepat
"user apa untuk skenario apa":

| Skenario yang mau di-tes             | Login sebagai                                                            |
| ------------------------------------ | ------------------------------------------------------------------------ |
| Login pertama + must-change-password | `newbie.eng@acme.test`                                                   |
| Login + MFA OTP                      | `hr2@acme.test`                                                          |
| Login + consent baru                 | User di luar `CONSENTED_TO_V2` (mis. `andi.eng@acme.test`)               |
| Clock in/out normal                  | `employee@acme.test` atau siapapun EMPLOYEE                              |
| Clock in di luar geofence            | Ubah koordinat browser di DevTools → Sensors                             |
| Ajukan cuti + approval 2 level       | Submit: `siti.eng@acme.test` → L1: `lead@acme.test` → L2: `hr@acme.test` |
| Overtime approval                    | Submit: `dian.ops@acme.test` → Approve: `agus.ops@acme.test`             |
| Correction absen                     | Submit: EMPLOYEE any → Approve: SUPERVISOR                               |
| Backlog fresh vs stale               | Login `hr@acme.test` → `/admin/approvals/backlog`                        |
| Timesheet approval                   | Login `hr@acme.test` → `/admin/timesheet`                                |
| Audit log viewer                     | Login `hr@acme.test` → `/admin/audit-log`                                |
| DSAR (data export)                   | Login any → `/settings/privacy/export`                                   |
| Right-to-erasure                     | Login any → `/settings/privacy/delete-account`                           |
| Security policy toggle (MFA enforce) | Login `admin@acme.test` → `/admin/security`                              |
| Cross-tenant admin                   | Login `admin@acme.test` → `/admin/companies`                             |

---

## 7. Reset & re-seed

Jika perlu balik ke state bersih:

```bash
# ⚠️ hapus semua data DB lokal
pnpm db:migrate:reset

# baseline saja (4 user)
pnpm db:seed

# baseline + fixtures UAT lengkap
pnpm db:seed:uat
```

`db:migrate:reset` sudah otomatis memanggil `db:seed` (dari
`prisma.seed` config). Kalau butuh fixtures UAT, jalankan `db:seed:uat`
tambahan setelahnya.

---

## 8. Security notes

- **Jangan pernah** commit password lain selain `password123` ke seed —
  seed jelas-jelas dilabeli "NOT for production" dan menolak boot bila
  `NODE_ENV=production`.
- **Jangan pernah** pakai email `@acme.test` di data production. Domain
  `.test` reserved oleh IETF (RFC 6761) sehingga aman untuk test.
- Bila mau demo eksternal, pertimbangkan **staging** dengan seed yang
  sama tapi password diganti + user demo di-isolate per audience.

---

_Terakhir diperbarui: 2026-08-07. Bila menambah user baru di seed,
update tabel di atas._
