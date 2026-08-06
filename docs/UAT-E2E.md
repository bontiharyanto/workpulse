# UAT (User Acceptance Testing) — End-to-End Scenarios

> **Audiens:** QA Lead, Business Analyst, Product Owner, HR pilot user.
> **Cakupan:** Alur bisnis lengkap Workpulse (auth, kehadiran, cuti, lembur, timesheet, admin, compliance, privasi).
> **Dokumen terkait:** [`ADMIN-GUIDE.md`](./ADMIN-GUIDE.md), [`USER-MANUAL.md`](./USER-MANUAL.md), [`WORKFLOW.md`](./WORKFLOW.md).

Dokumen ini berisi **skenario uji resmi** yang harus dieksekusi sebelum go-live. Setiap skenario ditulis dengan format standar (ID, prasyarat, langkah, hasil yang diharapkan, kriteria pass/fail) sehingga bisa dikerjakan tester non-teknis.

---

## Daftar Isi

1. [Cara Menggunakan Dokumen Ini](#1-cara-menggunakan-dokumen-ini)
2. [Persiapan Lingkungan UAT](#2-persiapan-lingkungan-uat)
3. [Peran & Akun Uji](#3-peran--akun-uji)
4. [Modul: Autentikasi (AUTH)](#4-modul-autentikasi-auth)
5. [Modul: Kehadiran (ATT)](#5-modul-kehadiran-att)
6. [Modul: Cuti (LV)](#6-modul-cuti-lv)
7. [Modul: Lembur (OT)](#7-modul-lembur-ot)
8. [Modul: Timesheet (TS)](#8-modul-timesheet-ts)
9. [Modul: Admin Governance (ADM)](#9-modul-admin-governance-adm)
10. [Modul: Compliance & Privasi (PRV)](#10-modul-compliance--privasi-prv)
11. [Modul: Notifikasi (NTF)](#11-modul-notifikasi-ntf)
12. [Cross-cutting: RBAC & Integritas Data (RBAC)](#12-cross-cutting-rbac--integritas-data-rbac)
13. [Non-functional (NFR)](#13-non-functional-nfr)
14. [Regresi Pasca Bug-fix (REG)](#14-regresi-pasca-bug-fix-reg)
15. [Ringkasan Sign-off](#15-ringkasan-sign-off)

---

## 1. Cara Menggunakan Dokumen Ini

### 1.1 Format Skenario

Setiap skenario ditulis dalam blok terstruktur:

| Field                | Keterangan                                                                    |
| -------------------- | ----------------------------------------------------------------------------- |
| **ID**               | Kode unik `MODUL-###` (contoh: `AUTH-001`) — referensi untuk laporan bug.     |
| **Judul**            | Nama skenario singkat.                                                        |
| **Prasyarat**        | Kondisi awal (akun, data, konfigurasi) yang harus disiapkan sebelum eksekusi. |
| **Peran**            | Role yang menjalankan skenario.                                               |
| **Langkah**          | Aksi-aksi berurutan (imperative).                                             |
| **Hasil Diharapkan** | Kondisi yang harus tercapai di setiap langkah.                                |
| **Prioritas**        | `P0` (blocker), `P1` (critical), `P2` (major), `P3` (minor).                  |
| **Kriteria Pass**    | Definisi _pass_ (semua hasil diharapkan tercapai) vs _fail_.                  |

### 1.2 Konvensi Status

| Status     | Arti                                                              |
| ---------- | ----------------------------------------------------------------- |
| ✅ PASS    | Semua langkah menghasilkan hasil sesuai.                          |
| ❌ FAIL    | Ada langkah yang tidak sesuai; catat detail + screenshot.         |
| ⚠️ BLOCKED | Tidak bisa dijalankan karena masalah environment atau dependency. |
| ⏭️ SKIPPED | Sengaja dilewatkan (jelaskan alasan di kolom catatan).            |

### 1.3 Definition of Done UAT

Go-live disetujui bila:

- **100%** skenario `P0` PASS.
- **≥ 95%** skenario `P1` PASS.
- **≥ 90%** skenario `P2` PASS.
- Tidak ada temuan open dengan tingkat _Critical_ atau _Blocker_.

---

## 2. Persiapan Lingkungan UAT

### 2.1 Setup

- URL: `https://uat.workpulse.example.com` (contoh — sesuaikan)
- Database: fresh clone dari staging, disemai dengan **seed UAT** (`pnpm db:seed:uat`) yang mencakup:
  - 1 tenant (`ACME`).
  - 3 departemen (`ENG`, `HR`, `OPS`).
  - 1 kantor pusat + geofence.
  - 3 shift (`STATIC 08–17`, `FLEXIBLE`, `ROTATING`).
  - 4 tipe cuti (Tahunan, Sakit, Melahirkan, Tanpa Bayaran).
  - Kalender hari libur nasional untuk 6 bulan ke depan.
  - 8 karyawan seed dengan riwayat 30 hari.
- Reset environment via `pnpm db:migrate:reset && pnpm db:seed:uat` **sebelum** memulai batch UAT.

### 2.2 Data & Waktu

- **Timezone UAT:** `Asia/Jakarta` (WIB, UTC+7).
- Semua _"tanggal hari ini"_ di skenario mengacu ke waktu server UAT.
- Untuk skenario yang butuh **tanggal masa lalu / masa depan**, tester bebas menentukan.

### 2.3 Peralatan Tester

- Chrome / Edge versi terkini.
- Aplikasi authenticator (Google Authenticator / Authy) di HP tester.
- Kamera aktif (untuk beberapa skenario kehadiran yang butuh selfie — bila diaktifkan).
- 2 tab browser (untuk cross-role testing).

---

## 3. Peran & Akun Uji

Seed UAT membuat akun berikut. Password default: `password123` (harus diganti pada login pertama karena `mustChangePassword=true`).

| Alias   | Email             | Role        | Departemen | Supervisor |
| ------- | ----------------- | ----------- | ---------- | ---------- |
| `EMP-1` | `budi@acme.test`  | EMPLOYEE    | ENG        | `SUP-1`    |
| `EMP-2` | `citra@acme.test` | EMPLOYEE    | ENG        | `SUP-1`    |
| `EMP-3` | `dedi@acme.test`  | EMPLOYEE    | OPS        | `SUP-2`    |
| `SUP-1` | `sari@acme.test`  | SUPERVISOR  | ENG        | —          |
| `SUP-2` | `roni@acme.test`  | SUPERVISOR  | OPS        | —          |
| `HR-1`  | `hr@acme.test`    | HR_MANAGER  | HR         | —          |
| `SA-1`  | `admin@acme.test` | SUPER_ADMIN | —          | —          |

---

## 4. Modul: Autentikasi (AUTH)

### AUTH-001 — Login pertama kali & wajib ganti password (P0)

**Prasyarat:** Akun `EMP-1` baru dibuat, `mustChangePassword=true`.

**Langkah:**

1. Buka `/login`.
2. Masukkan email `budi@acme.test`, password `password123`.
3. Klik **Masuk**.
4. Sistem meng-_redirect_ ke `/change-password`.
5. Isi password lama (`password123`), password baru (`Coba123!aman`), konfirmasi.
6. Klik **Simpan**.
7. Cek banner sukses & redirect ke `/attendance`.

**Hasil Diharapkan:**

- Langkah 3: Response API 200, cookie `wp_refresh` terset (HttpOnly).
- Langkah 4: URL tepat `/change-password`; menu sidebar tidak dapat diakses.
- Langkah 7: Banner sukses tampil dengan `role="status"`; halaman kehadiran termuat.

**Kriteria Pass:** Semua hasil di atas + entri `AuditLog(AUTH_PASSWORD_CHANGE)` untuk user.

---

### AUTH-002 — Login gagal karena password salah (P0)

**Prasyarat:** Akun `EMP-1` sudah setup password.

**Langkah:**

1. Buka `/login`.
2. Masukkan email benar, password acak salah.
3. Klik **Masuk** 5x berturut-turut.

**Hasil Diharapkan:**

- Percobaan 1–4: Alert "Email atau kata sandi salah." tampil, form tetap responsif.
- Percobaan 5: Alert berubah menjadi "Terlalu banyak percobaan. Silakan coba lagi nanti." (throttled).
- Tidak ada info yang mengindikasikan apakah email tersebut _terdaftar_ atau tidak (mencegah user enumeration).

**Kriteria Pass:** Throttling aktif setelah 5x fail; response time login tetap konstan (< 1s) walau user tidak ada (constant-time argon2 check).

---

### AUTH-003 — Lupa password → reset via email (P1)

**Prasyarat:** Akun `EMP-2` aktif; akses inbox email UAT tersedia.

**Langkah:**

1. Di `/login`, klik "Lupa password?".
2. Isi email `citra@acme.test`, submit.
3. Buka inbox → klik link reset.
4. Isi password baru + konfirmasi.
5. Submit.
6. Login dengan password baru.

**Hasil Diharapkan:**

- Langkah 2: Halaman berhasil mengirim email (pesan "Bila email terdaftar, link reset dikirim.").
- Langkah 3: Link berlaku 1 jam; membuka form reset.
- Langkah 5: Redirect ke `/login?changed=1`, banner sukses.
- Langkah 6: Login sukses dengan password baru; password lama ditolak.

---

### AUTH-004 — Aktifkan MFA untuk HR (mandatory) (P0)

**Prasyarat:** `HR-1` login pertama kali; `MFA_ENFORCE_HR_ADMIN=true`.

**Langkah:**

1. Login sebagai `HR-1`.
2. Sistem redirect ke `/setup-mfa` (bukan `/attendance`).
3. Scan QR dengan authenticator app.
4. Masukkan kode 6-digit yang muncul di app.
5. Simpan 10 backup code.
6. Klik **Selesai**.

**Hasil Diharapkan:**

- Sebelum langkah 6 selesai, sidebar / menu utama tidak bisa diakses.
- Setelah 6: user diarahkan ke dashboard HR, MFA aktif.
- Login berikutnya wajib input kode TOTP.

---

### AUTH-005 — Login dengan MFA (TOTP) (P0)

**Prasyarat:** `HR-1` sudah enrol MFA (AUTH-004).

**Langkah:**

1. Buka `/login`.
2. Email + password → **Masuk**.
3. Redirect otomatis ke `/login/mfa`.
4. Buka authenticator, masukkan kode 6-digit.
5. **Verifikasi**.

**Hasil Diharapkan:** Redirect ke dashboard HR; `mfaPassed=true` di response `/auth/me`.

---

### AUTH-006 — Login dengan backup code (P1)

**Langkah:**

1. Login `HR-1`, di layar MFA klik **Gunakan backup code**.
2. Masukkan salah satu backup code.
3. Verifikasi.

**Hasil Diharapkan:** Login sukses; code yang dipakai ditandai `used_at`, tidak bisa dipakai ulang.

---

### AUTH-007 — Session revocation via ubah password (P1)

**Prasyarat:** `EMP-1` login di 2 browser (Chrome & Firefox).

**Langkah:**

1. Di Chrome: `/change-password`, ganti password.
2. Di Firefox: refresh atau klik menu apa saja.

**Hasil Diharapkan:** Firefox otomatis logout, redirect ke `/login`, cookie refresh sudah tidak valid.

---

### AUTH-008 — Refresh token reuse detection (P0, security)

**Prasyarat:** Login `EMP-1`. Ambil cookie `wp_refresh` via DevTools.

**Langkah:**

1. Simpan nilai cookie `wp_refresh` (mis. `R1`).
2. Reload halaman → sistem otomatis refresh; cookie berubah ke `R2`.
3. Manipulasi cookie balik ke `R1`.
4. Reload lagi.

**Hasil Diharapkan:**

- Langkah 4: sistem mendeteksi reuse `R1`, meng-_revoke_ seluruh family (`R2` juga tak valid), redirect ke `/login`, `AuditLog(AUTH_REFRESH_REUSE_DETECTED)` terisi.

---

## 5. Modul: Kehadiran (ATT)

### ATT-001 — Clock-in di dalam geofence (P0)

**Prasyarat:** `EMP-1` login. Browser diberi izin lokasi. Set lokasi (via DevTools > Sensors) ke koordinat kantor + < radius.

**Langkah:**

1. Buka `/attendance`.
2. Klik **Clock-in**.
3. Tunggu 2 detik.

**Hasil Diharapkan:**

- Status berubah menjadi "Sudah clock-in" + waktu terekam.
- Tombol berubah menjadi **Clock-out**.
- Data tersimpan di `AttendanceRecord` dengan `status ∈ {PRESENT, LATE}` tergantung shift.
- **Tidak ada** field `isInsideGeofence` di request client — validasi server-only.

---

### ATT-002 — Clock-in di luar geofence — DITOLAK (P0)

**Prasyarat:** Set lokasi browser ke koordinat rumah/warung (> radius geofence).

**Langkah:**

1. `/attendance` → **Clock-in**.

**Hasil Diharapkan:** Alert error "OUTSIDE_GEOFENCE" atau pesan lokalized "Anda berada di luar area kantor." Tidak ada record kehadiran tersimpan.

---

### ATT-003 — Clock-in ditolak izin lokasi (P1)

**Prasyarat:** Browser diblok/deny lokasi.

**Langkah:**

1. `/attendance`.

**Hasil Diharapkan:** Tombol Clock-in disabled dengan tooltip "Izin lokasi diperlukan." Panduan cara meng-_allow_ muncul.

---

### ATT-004 — Clock-in di luar jam shift ditandai LATE (P1)

**Prasyarat:** Shift `EMP-1` = 08:00–17:00; set jam server / clock-in pukul 09:15.

**Langkah:**

1. Clock-in.

**Hasil Diharapkan:** `AttendanceRecord.status = 'LATE'`, badge merah di UI, lateBy = 75 menit.

---

### ATT-005 — Clock-out lebih awal ditandai EARLY_LEAVE (P1)

**Prasyarat:** Sudah clock-in normal. Clock-out pukul 15:30 (shift 08–17).

**Hasil Diharapkan:** Status akhir `EARLY_LEAVE`; total jam berkurang di timesheet.

---

### ATT-006 — Lupa clock-out (NO_CLOCKOUT) (P1)

**Prasyarat:** Clock-in kemarin, tidak clock-out. Job scheduler jalan tengah malam.

**Hasil Diharapkan:** Record ditutup otomatis dengan status `NO_CLOCKOUT`; muncul di halaman `/attendance` sebagai "perlu koreksi".

---

### ATT-007 — Ajukan koreksi kehadiran (P0)

**Langkah:**

1. Buka baris kehadiran bermasalah → **Koreksi**.
2. Jenis `MISSING_CLOCK_OUT`, waktu 17:30, alasan ≥ 10 karakter.
3. Kirim.
4. Login `SUP-1`, approve.
5. Kembali ke `EMP-1` → cek status koreksi = APPROVED, baris kehadiran ter-_update_ dengan flag "dikoreksi".

**Hasil Diharapkan:** Baris asli **tidak diubah**, ditandai `correctedById`; ada baris baru `AttendanceCorrection`.

---

### ATT-008 — Koreksi ditolak dengan alasan (P1)

Sama dengan ATT-007, langkah 4 = **Reject** dengan alasan. Karyawan menerima notifikasi + alasan tampil di riwayat.

---

## 6. Modul: Cuti (LV)

### LV-001 — Ajukan cuti dengan saldo cukup (P0)

**Prasyarat:** `EMP-1` punya saldo Cuti Tahunan 12 hari; sisa 10.

**Langkah:**

1. `/leave` → **Ajukan cuti**.
2. Tipe: `ANNUAL`; tanggal: H+7 s/d H+8 (2 hari kerja); alasan: "Urusan keluarga di luar kota".
3. Kirim.

**Hasil Diharapkan:**

- Muncul di daftar dengan status `PENDING`.
- Saldo tampil: Sisa 10, Pending 2.
- Notifikasi ke `SUP-1`.

---

### LV-002 — Saldo tidak cukup (P0)

**Prasyarat:** Saldo `EMP-2` = 1 hari.

**Langkah:**

1. Ajukan 3 hari.

**Hasil Diharapkan:** Error `INSUFFICIENT_BALANCE`, pengajuan tidak tersimpan.

---

### LV-003 — Overlap dengan pengajuan lain (P1)

**Prasyarat:** `EMP-1` sudah punya pengajuan `PENDING` tanggal H+7 s/d H+8.

**Langkah:**

1. Ajukan lagi tanggal H+8 s/d H+9.

**Hasil Diharapkan:** Error `LEAVE_OVERLAP`.

---

### LV-004 — Advance notice violation (P2)

**Prasyarat:** Tipe cuti Tahunan butuh minimum H+3 hari.

**Langkah:**

1. Ajukan besok (H+1).

**Hasil Diharapkan:** Error `ADVANCE_NOTICE_REQUIRED`.

---

### LV-005 — Approval chain lengkap (P0)

**Prasyarat:** LV-001 tersimpan `PENDING`.

**Langkah:**

1. `SUP-1` login → `/leave/approvals` → Approve.
2. Cek status: `APPROVED_L1`.
3. `HR-1` login → `/leave/approvals` → Approve.
4. Cek status: `APPROVED_L2`.
5. Kembali ke `EMP-1` → saldo terpakai bertambah 2, notifikasi diterima.

**Hasil Diharapkan:**

- Saldo **belum dikurangi** setelah langkah 2 (L1); baru dikurangi setelah langkah 4 (L2), di dalam single transaction (invariant §2 security-rules).
- `AuditLog(LEAVE_APPROVE)` ada 2 baris (aktor SUP-1, aktor HR-1).

---

### LV-006 — Reject dengan alasan (P1)

**Langkah:**

1. `SUP-1` → Reject pengajuan LV-001 dengan alasan ≥ 10 karakter.
2. Cek status: `REJECTED`, alasan tampil.
3. `EMP-1` menerima notifikasi.

---

### LV-007 — Batalkan pengajuan PENDING (P1)

**Langkah:**

1. `EMP-1` → daftar cuti → **Batalkan**.
2. Konfirmasi.

**Hasil Diharapkan:** Status → `CANCELLED`; saldo Pending kembali ke 0.

---

### LV-008 — Race condition — dua pengajuan bersamaan (P0)

**Prasyarat:** Saldo `EMP-1` sisa 1 hari.

**Langkah:**

1. Buka 2 tab, submit pengajuan 1 hari secara bersamaan (klik Kirim dalam waktu < 500ms).

**Hasil Diharapkan:** Salah satu sukses, yang lain gagal `INSUFFICIENT_BALANCE` — **tidak boleh dua-duanya sukses** (SELECT ... FOR UPDATE di transaksi).

---

### LV-009 — Upload attachment untuk cuti sakit (P1)

**Prasyarat:** Tipe cuti `SICK`, `requiresAttachment=true` untuk durasi ≥ 2 hari.

**Langkah:**

1. Ajukan 3 hari sakit tanpa attachment → error `ATTACHMENT_REQUIRED`.
2. Upload PDF 3 MB → sukses.
3. Upload file 10 MB → error `ATTACHMENT_TOO_LARGE`.
4. Upload .exe → error `ATTACHMENT_TYPE_NOT_ALLOWED`.

---

## 7. Modul: Lembur (OT)

### OT-001 — Pre-approval lembur weekday (P0)

**Langkah:**

1. `EMP-1` → `/overtime` → **Ajukan lembur**.
2. Tanggal H+1 (weekday), jam 18:00–20:00, alasan proyek.
3. Kirim.
4. Cek estimasi biaya: 2 jam × rate × 1.5.
5. `SUP-1` approve → `HR-1` approve.

**Hasil Diharapkan:** Status `APPROVED_L2`. Bila tanggal tersebut sudah lewat + jam sudah masuk timesheet, kolom lembur ter-update.

---

### OT-002 — Cap harian dilampaui (P0)

**Prasyarat:** Cap harian = 4 jam.

**Langkah:**

1. Ajukan 6 jam.

**Hasil Diharapkan:** Error `OVERTIME_CAP_EXCEEDED`.

---

### OT-003 — Cap bulanan dilampaui (P1)

**Prasyarat:** Sudah ada 38 jam approved bulan ini; cap 40 jam.

**Langkah:**

1. Ajukan 3 jam baru.

**Hasil Diharapkan:** Error `OVERTIME_CAP_EXCEEDED` (sisa 2 jam).

---

### OT-004 — Multiplier weekend & public holiday (P1)

**Langkah:**

1. Ajukan lembur di hari Sabtu 4 jam → estimasi × 2.0.
2. Ajukan di hari libur nasional 4 jam → estimasi × 3.0.

**Hasil Diharapkan:** Total rupiah sesuai perhitungan server; client hanya menampilkan.

---

### OT-005 — Post-approval mode (P2)

**Prasyarat:** HR mengaktifkan post-approval untuk departemen OPS.

**Langkah:**

1. `EMP-3` (OPS) → `/overtime` → **Catat lembur (post-hoc)**.
2. Isi tanggal kemarin, 20:00–23:00, alasan + attachment.
3. Kirim → approval chain.

**Hasil Diharapkan:** Sukses; badge "post-approval" di baris.

---

### OT-006 — Reject dengan alasan (P2)

Setara LV-006.

---

## 8. Modul: Timesheet (TS)

### TS-001 — HR generate periode berjalan (P0)

**Prasyarat:** Data attendance/cuti/lembur terisi untuk periode.

**Langkah:**

1. `HR-1` → `/admin/timesheet` → **Generate periode berjalan**.
2. Cek daftar timesheet muncul untuk semua karyawan, status `DRAFT`.

**Hasil Diharapkan:** Baris `Timesheet` per user, agregat sesuai attendance + leave + overtime. `AuditLog(TIMESHEET_GENERATE)` terisi.

---

### TS-002 — Karyawan konfirmasi timesheet (P0)

**Langkah:**

1. `EMP-1` → `/me/timesheet` → review → **Konfirmasi timesheet**.
2. Status: `SUBMITTED`.

---

### TS-003 — Supervisor approve L1 (P0)

**Langkah:** `SUP-1` → `/admin/timesheet` → approve → status `APPROVED_L1`.

---

### TS-004 — HR approve L2 & lock (P0)

**Langkah:** `HR-1` → approve → status `APPROVED_L2`; klik **Lock** → status `LOCKED`.

---

### TS-005 — Reject timesheet dengan alasan (P1)

**Langkah:** `SUP-1` reject → status kembali `DRAFT`, alasan tampil ke karyawan.

---

### TS-006 — HR reopen timesheet locked (P1)

**Prasyarat:** Ada `LOCKED`.

**Langkah:** HR → detail → **Reopen** dengan alasan ≥ 20 karakter → status kembali `APPROVED_L2`; `AuditLog(TIMESHEET_REOPEN)` terisi.

---

### TS-007 — Ekspor CSV timesheet (P1)

**Langkah:**

1. `/admin/timesheet/exports` → filter periode → **Ekspor CSV**.
2. Unduh file.

**Hasil Diharapkan:** File valid, kolom sesuai template, `AuditLog(TIMESHEET_EXPORT)` terisi.

---

### TS-008 — Auto-generate scheduler (P2)

**Prasyarat:** Config auto-generate aktif, cut-off hari ini.

**Langkah:** Jalankan scheduler manual atau tunggu 02:00 UTC.

**Hasil Diharapkan:** Timesheet ter-generate tanpa intervensi HR.

---

## 9. Modul: Admin Governance (ADM)

### ADM-001 — CRUD Karyawan (P0)

**Langkah:**

1. `HR-1` → `/admin/users` → **Tambah**.
2. Isi form → simpan.
3. Cek email undangan terkirim (mock inbox).
4. Edit → ubah departemen.
5. Terminate.

**Hasil Diharapkan:** State transitions terekam di audit log; user TERMINATED tidak bisa login.

---

### ADM-002 — Ganti supervisor & reroute approval (P1)

**Prasyarat:** `EMP-2` punya pengajuan cuti pending diapprove `SUP-1`.

**Langkah:**

1. HR ubah `supervisorId` `EMP-2` ke `SUP-2`.
2. Buka `SUP-2` → `/leave/approvals` → pengajuan `EMP-2` muncul.
3. `SUP-1` → tidak lagi menampilkan pengajuan tersebut.

---

### ADM-003 — CRUD Departemen (P1)

Buat, edit, hapus. Hapus ditolak bila masih ada anggota aktif.

---

### ADM-004 — CRUD Geofence (P1)

Buat 2 geofence, edit radius, hapus salah satu (tidak bisa jika masih dipakai shift aktif).

---

### ADM-005 — CRUD Shift (P1)

Buat 3 shift (static/flex/rotating), assign ke departemen. Verifikasi karyawan menerima shift.

---

### ADM-006 — Adjust saldo cuti manual (P0)

**Langkah:**

1. `/admin/users/{id}` → **Sesuaikan saldo** → +5 hari Tahunan, alasan.
2. Simpan.
3. `EMP-1` cek saldo tampilan.

**Hasil Diharapkan:** Saldo + 5; baris `LeaveBalanceAdjustment` + `AuditLog(LEAVE_BALANCE_OVERRIDE)`.

---

### ADM-007 — Konfigurasi tipe cuti (P1)

Ubah `defaultQuotaDays`, `advanceRequiredDays`, `requiresAttachment`. Verifikasi validasi baru berlaku untuk pengajuan berikutnya.

---

### ADM-008 — Reset password admin override (P1)

`HR-1` reset password `EMP-1`. Semua sesi user logout; email link reset dikirim.

---

### ADM-009 — Impersonate user (P1, security)

`SA-1` impersonate `EMP-1` dengan alasan. Semua request selama impersonate menulis dua kolom aktor.

---

### ADM-010 — Webhook lifecycle (P2)

Registrasi webhook, kirim test event, deteksi retry, force-fail 5x → item pindah ke DLQ.

---

### ADM-011 — Audit log immutability (P0)

Coba `UPDATE`/`DELETE` baris `AuditLog` via psql sebagai user aplikasi → operation denied.

---

### ADM-012 — Backlog approval — HR klaim (P1)

**Prasyarat:** Ada pengajuan cuti > 48 jam belum diapprove.

**Langkah:** `HR-1` → `/admin/approvals-backlog` → **Klaim** → approve.

**Hasil Diharapkan:** Bypass supervisor, `AuditLog(APPROVAL_CLAIMED_BY_HR)` terisi.

---

## 10. Modul: Compliance & Privasi (PRV)

### PRV-001 — Publikasi kebijakan privasi baru & force-consent (P0)

**Langkah:**

1. `HR-1` → `/admin/privacy/policies` → **Terbitkan versi baru** → isi form → publish.
2. Logout, login sebagai `EMP-1`.
3. Sistem redirect ke `/consent`.
4. Baca, centang persetujuan, **Terima & lanjutkan**.
5. Cek `/settings/privacy` → riwayat consent menampilkan versi baru.

**Hasil Diharapkan:** Force-route bekerja untuk semua user; menerima menghapus flag `pendingConsent`.

---

### PRV-002 — Ekspor data pribadi (DSAR) (P0)

**Langkah:**

1. `EMP-1` → `/settings/privacy` → **Ajukan ekspor data**.
2. Poll status hingga `READY` (biasanya < 5 menit).
3. **Unduh** file ZIP.
4. Buka ZIP, verifikasi berisi data profil + kehadiran + cuti + lembur + timesheet + audit log + consent history.

**Hasil Diharapkan:** File valid; URL unduhan expired setelah 72 jam.

---

### PRV-003 — Cooldown ekspor data (P2)

**Langkah:** Segera ajukan ekspor kedua.

**Hasil Diharapkan:** Error `EXPORT_COOLDOWN` dengan sisa waktu.

---

### PRV-004 — Ajukan penghapusan data → HR approve → schedule (P0)

**Langkah:**

1. `EMP-1` → **Ajukan penghapusan data**.
2. `HR-1` → `/admin/privacy/erasure-requests` → **Approve**, set scheduledFor H+7.
3. Cek notifikasi ke `EMP-1`.

---

### PRV-005 — Batalkan penghapusan sebelum scheduled (P1)

**Langkah:** `EMP-1` → `/settings/privacy` → **Batalkan** permintaan.

**Hasil Diharapkan:** Status `CANCELLED`; job harian tidak menjalankan penghapusan.

---

### PRV-006 — Eksekusi penghapusan otomatis (P0)

**Prasyarat:** Permintaan `APPROVED`, `scheduledFor` lewat, job dijalankan.

**Hasil Diharapkan:**

- Nama, email diganti hash.
- Kehadiran/cuti/lembur/timesheet dianonimkan (`userId` diganti UUID sintetis).
- Audit log **tidak** dihapus.
- Laporan hasil tersedia di `/admin/privacy/retention/audit-reports`.

---

### PRV-007 — Ubah kebijakan retensi (P1)

`HR-1` → `/admin/privacy/retention` → ubah `notificationRetentionDays` dari 30 → 60 → simpan.

**Hasil Diharapkan:** Perubahan efektif pada job berikutnya; nilai lama tidak dihapus (retroaktif).

---

### PRV-008 — ROPA — CRUD aktivitas (P2)

`HR-1` → `/admin/ropa` → tambah entri baru, edit, verifikasi field ter-_lock_ setelah DPIA approve.

---

### PRV-009 — DPIA workflow (P2)

Buat DPIA untuk aktivitas geolokasi, isi 5 langkah wizard, submit → review → approve.

---

### PRV-010 — Vendor register (P2)

Tambah vendor "PayrollCo", isi DPA info, upload dokumen kontrak.

---

### PRV-011 — Breach ledger entry (P1)

**Langkah:** `HR-1` → `/admin/security/breaches` → tambah insiden, upload PDF investigasi, submit.

**Hasil Diharapkan:** Entri ter-lock setelah 30 hari.

---

## 11. Modul: Notifikasi (NTF)

### NTF-001 — In-app notifikasi approval (P1)

**Langkah:** Setiap event approval memicu notifikasi in-app. Cek ikon lonceng bertambah, klik → daftar tampil.

---

### NTF-002 — Email notifikasi approval (P1)

Cek inbox mock; email terkirim dengan link deep ke `/leave/{id}`.

---

### NTF-003 — Preferensi mute email (P2)

`EMP-1` → `/settings/notifications` → matikan email untuk kategori Approval. Trigger event → email tidak dikirim; in-app tetap muncul.

---

### NTF-004 — Kategori wajib tidak bisa di-mute (P1)

Coba mute kategori "Hukum & keamanan" → toggle disabled dengan tooltip.

---

## 12. Cross-cutting: RBAC & Integritas Data (RBAC)

### RBAC-001 — Employee tidak bisa akses /admin/** (P0)

**Langkah:** `EMP-1` mencoba URL manual `/admin/users`.

**Hasil Diharapkan:** Redirect ke `/attendance` atau 403.

---

### RBAC-002 — Supervisor tidak bisa lihat data tim lain (P0)

**Langkah:** `SUP-1` (departemen ENG) coba lihat data karyawan di OPS via API atau URL.

**Hasil Diharapkan:** 403 `FORBIDDEN`. Payload tidak leak nama/detail user.

---

### RBAC-003 — Cross-tenant data isolation (P0)

**Prasyarat:** Ada 2 tenant di dev/UAT.

**Langkah:** User tenant A coba akses resource ID tenant B via API dengan token valid.

**Hasil Diharapkan:** 404 (bukan 403 — biar tidak leak keberadaan).

---

### RBAC-004 — SUPER_ADMIN cross-tenant access teraudit (P1)

**Langkah:** `SA-1` akses tenant lain → `AuditLog(CROSS_TENANT_ACCESS)` terisi dengan flag khusus.

---

### RBAC-005 — Frontend menu hidden vs API guard (P0)

Bandingkan: sidebar menyembunyikan `/admin/*` untuk EMPLOYEE. Coba hit API `/api/v1/admin/users` dengan token EMPLOYEE → tetap 403.

**Hasil Diharapkan:** Server guard adalah source-of-truth; frontend hanya polish UX.

---

## 13. Non-functional (NFR)

### NFR-001 — Login latency (P1)

Login 100x konsekutif, ambil P95. Target: < 800ms.

### NFR-002 — Dashboard first paint (P2)

Buka `/attendance` sebagai `EMP-1`; ukur waktu sampai konten utama tampil. Target: < 2.5s (Fast 3G).

### NFR-003 — Timesheet export volume (P2)

Ekspor 5000 baris CSV. Target: < 15 detik + file valid.

### NFR-004 — Rate limit endpoint kritis (P1)

Hit `/auth/login` 10x/menit dari IP sama → 5 request berhasil, 5 sisanya 429.

### NFR-005 — Availability check (P1)

Ping `/api/v1/health` 100x → 100% 200 OK.

### NFR-006 — Accessibility (P2)

Jalankan Lighthouse / axe pada 5 halaman kunci (login, kehadiran, cuti, approval, timesheet). Target: score ≥ 90.

### NFR-007 — Backup restore (P0)

Uji restore backup DB ke environment kosong, verifikasi integritas data.

---

## 14. Regresi Pasca Bug-fix (REG)

Setiap kali ada rilis patch, jalankan mini-suite berikut sebagai smoke test:

- AUTH-001, AUTH-005 (login normal + MFA)
- ATT-001 (clock-in normal)
- LV-005 (approval cuti L1+L2)
- OT-001 (approval lembur)
- TS-001..TS-004 (timesheet full cycle)
- PRV-001 (consent flow)
- RBAC-001, RBAC-002 (guard)

Waktu eksekusi target: **< 30 menit** manual atau **< 10 menit** via Playwright suite (`pnpm e2e -- --grep 'smoke'`).

---

## 15. Ringkasan Sign-off

### 15.1 Rekap Eksekusi (isi setelah run)

| Modul     |  Total | ✅ Pass | ❌ Fail | ⚠️ Blocked | ⏭️ Skipped |
| --------- | -----: | ------: | ------: | ---------: | ---------: |
| AUTH      |      8 |         |         |            |            |
| ATT       |      8 |         |         |            |            |
| LV        |      9 |         |         |            |            |
| OT        |      6 |         |         |            |            |
| TS        |      8 |         |         |            |            |
| ADM       |     12 |         |         |            |            |
| PRV       |     11 |         |         |            |            |
| NTF       |      4 |         |         |            |            |
| RBAC      |      5 |         |         |            |            |
| NFR       |      7 |         |         |            |            |
| **Total** | **78** |         |         |            |            |

### 15.2 Temuan Terbuka

| ID Bug | Judul | Modul | Skenario Asal | Prioritas | Status |
| ------ | ----- | ----- | ------------- | --------- | ------ |
|        |       |       |               |           |        |

### 15.3 Sign-off

| Nama          | Peran                   | Tanda Tangan | Tanggal |
| ------------- | ----------------------- | ------------ | ------- |
| _____________ | Product Owner           |              |         |
| _____________ | QA Lead                 |              |         |
| _____________ | Engineering Lead        |              |         |
| _____________ | Data Protection Officer |              |         |
| _____________ | HR Manager (pilot user) |              |         |

**Keputusan:**

- [ ] Approved untuk go-live tanpa syarat.
- [ ] Approved dengan syarat (list temuan yang harus diperbaiki dalam N hari).
- [ ] Ditolak — jelaskan.

---

## Lampiran A — Template Laporan Bug

```
Bug ID:      BUG-YYYYMMDD-###
Judul:       (satu kalimat, deskripsi singkat)
Skenario:    AUTH-001 (referensi UAT)
Environment: UAT / Chrome 130 / macOS 14
Prioritas:   Blocker / Critical / Major / Minor
Aktor:       EMP-1 (budi@acme.test)

Langkah Reproduksi:
1. ...
2. ...

Hasil Aktual:
...

Hasil Diharapkan:
...

Bukti:
- Screenshot: [link]
- Screen recording: [link]
- Console log: [attach]

Frekuensi:
- [ ] Selalu terjadi
- [ ] Kadang-kadang (jelaskan pola)
- [ ] Sekali saja

Impact:
...

Workaround (bila ada):
...
```

## Lampiran B — Mapping ke Automated E2E

Beberapa skenario UAT juga dieksekusi otomatis di Playwright. Bila UAT manual berbeda hasil dengan CI otomatis, prioritaskan investigasi karena kemungkinan environment drift.

| UAT ID                       | Playwright spec                                                         |
| ---------------------------- | ----------------------------------------------------------------------- |
| AUTH-001, AUTH-002           | `apps/e2e/tests/auth.spec.ts`                                           |
| AUTH-004, AUTH-005, AUTH-006 | `apps/e2e/tests/mfa-ui.spec.ts`                                         |
| ATT-001..ATT-007             | `apps/e2e/tests/attendance-*.spec.ts`                                   |
| LV-001, LV-005               | `apps/e2e/tests/leave.spec.ts`                                          |
| OT-001                       | `apps/e2e/tests/overtime.spec.ts`                                       |
| TS-001..TS-004               | (belum otomatis, targetkan Fase berikut)                                |
| PRV-001, PRV-002             | `apps/e2e/tests/retention-consent-ui.spec.ts`, `data-export-ui.spec.ts` |
| PRV-004, PRV-005             | `apps/e2e/tests/data-erasure-ui.spec.ts`                                |
