# Panduan Administrasi — Workpulse

> **Audiens:** HR Manager, Super Admin, IT Operations.
> **Prasyarat:** Akun aktif dengan role `HR_MANAGER` atau `SUPER_ADMIN`. MFA opsional di MVP — HR bisa mengaktifkannya sendiri via `/settings/security` jika mau lapisan keamanan ekstra.
> **Dokumen terkait:** [`USER-MANUAL.md`](./USER-MANUAL.md), [`UAT-E2E.md`](./UAT-E2E.md), [`WORKFLOW.md`](./WORKFLOW.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md).

Dokumen ini menjelaskan alur operasional harian & konfigurasi tenant di Workpulse. Setiap prosedur mencantumkan **rute UI**, **peran minimum**, dan **efek samping** (audit log, notifikasi, immutability) supaya administrator tahu apa yang berubah di sistem.

---

## Daftar Isi

1. [Model Peran & Otorisasi](#1-model-peran--otorisasi)
2. [Onboarding Tenant Baru](#2-onboarding-tenant-baru)
3. [Manajemen Karyawan](#3-manajemen-karyawan)
4. [Struktur Organisasi](#4-struktur-organisasi)
5. [Konfigurasi Kehadiran](#5-konfigurasi-kehadiran)
6. [Konfigurasi Cuti](#6-konfigurasi-cuti)
7. [Konfigurasi Lembur](#7-konfigurasi-lembur)
8. [Timesheet — Generate, Approval, Ekspor](#8-timesheet--generate-approval-ekspor)
9. [Approval Backlog & Delegasi](#9-approval-backlog--delegasi)
10. [Analytics & Laporan](#10-analytics--laporan)
11. [Compliance — ROPA, DPIA, Retensi, Vendor](#11-compliance--ropa-dpia-retensi-vendor)
12. [Kebijakan Privasi & Consent](#12-kebijakan-privasi--consent)
13. [Permintaan Penghapusan Data (Right to Erasure)](#13-permintaan-penghapusan-data-right-to-erasure)
14. [Breach Ledger](#14-breach-ledger)
15. [Webhook & Integrasi](#15-webhook--integrasi)
16. [Audit Log & Immutability](#16-audit-log--immutability)
17. [Penggunaan API (Quota, Throttling)](#17-penggunaan-api-quota-throttling)
18. [Super Admin — Manajemen Tenant](#18-super-admin--manajemen-tenant)
19. [Runbook Insiden](#19-runbook-insiden)

---

## 1. Model Peran & Otorisasi

| Role          | Cakupan Data                     | Kapabilitas Kunci                                                                                    |
| ------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `EMPLOYEE`    | Data sendiri                     | Kehadiran, ajukan cuti/lembur, lihat timesheet sendiri, kelola pengaturan pribadi                    |
| `SUPERVISOR`  | Tim langsung (bawahan)           | Semua kapabilitas Employee + approval level 1 (cuti, lembur, timesheet), rekap kehadiran tim         |
| `HR_MANAGER`  | Seluruh perusahaan (`companyId`) | Semua kapabilitas Supervisor + approval level 2, data master, laporan, compliance, kebijakan privasi |
| `SUPER_ADMIN` | Lintas tenant                    | Semua kapabilitas HR + manajemen tenant + override yang teraudit                                     |

> **Invariant:** Setiap request masuk melewati `JwtAuthGuard` → `RolesGuard`. Frontend hanya menyembunyikan menu; **otorisasi resmi ada di server**. Setiap mutasi sensitif (approval, override balance, edit admin) menulis baris `AuditLog` di transaksi yang sama.

---

## 2. Onboarding Tenant Baru

**Rute:** `/admin/companies` (hanya `SUPER_ADMIN`) → **Konfigurasi Perusahaan** (`/admin/company`, HR).

### 2.1 Buat Tenant (Super Admin)

1. Buka **Data Master → Tenant** (`/admin/companies`).
2. Klik **Tambah Tenant**, isi: nama, domain email (opsional untuk auto-assign), timezone (`Asia/Jakarta` default), locale.
3. Sistem membuat baris `Company`, `Department` default, dan seed user `HR_MANAGER` pertama (email pengelola akan dikirimi undangan reset password).
4. Cek `AuditLog` (kategori `TENANT_CREATE`) untuk verifikasi.

### 2.2 Setting Perusahaan (HR / Super Admin)

**Rute:** `/admin/company`.

Bidang wajib diisi sebelum modul lain siap dipakai:

| Bidang                    | Efek                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nama perusahaan, logo     | Header aplikasi, watermark ekspor PDF                                                                                                                                                                                                                                                                                                                                     |
| Timezone                  | Semua timestamp UI dikonversi ke zona ini; server menyimpan UTC                                                                                                                                                                                                                                                                                                           |
| Working days default      | Basis kalkulasi cuti (working-day vs calendar-day)                                                                                                                                                                                                                                                                                                                        |
| Cut-off periode timesheet | Tanggal potong bulanan/dua-mingguan                                                                                                                                                                                                                                                                                                                                       |
| MFA enforcement           | **Per-tenant toggle** di `/admin/security` (SUPER_ADMIN only). MVP default: opt-in (toggle **OFF**). Aktifkan untuk mewajibkan MFA pada semua HR Manager & Super Admin di tenant Anda — berefek dalam ~30 detik tanpa restart API. Lihat [ADR-0017 Revision 2](./ADR/ADR-0017-mfa-totp.md#revision-2--per-tenant-db-toggle-2026-08-06-pm) untuk detail runtime dan audit. |

### 2.3 Checklist Onboarding

- [ ] Timezone & kalender kerja terisi
- [ ] Minimal 1 departemen
- [ ] Minimal 1 geofence (untuk kantor pusat)
- [ ] Minimal 1 shift default
- [ ] Minimal 1 tipe cuti + quota awal
- [ ] Kebijakan privasi versi 1 dipublikasikan
- [ ] Retensi data dikonfigurasi
- [ ] Import daftar karyawan (CSV) atau invite manual

---

## 3. Manajemen Karyawan

**Rute:** `/admin/users` (Data Master → Karyawan).

### 3.1 Tambah Karyawan

1. Klik **Tambah Karyawan**.
2. Isi form: `fullName`, `email` (harus unik per tenant), `role`, `departmentId`, `supervisorId` (opsional), `hiredAt`, `overtimeHourlyRate`.
3. Sistem mengirim email _set-password_ (link berlaku 24 jam).
4. Field `mustChangePassword=true` disetel — user wajib ganti password pada login pertama.

> **Catatan:** `overtimeHourlyRate` disimpan per user. Kalkulasi rate lembur (Weekday / Weekend / Public Holiday) mengalikan angka ini dengan pengganda yang dikonfigurasi di **Konfigurasi Perusahaan**.

### 3.2 Ubah Status Kepegawaian

Transisi state `employmentStatus`:

```
ACTIVE → SUSPENDED  (login diblokir sementara, data tetap)
ACTIVE → TERMINATED (login diblokir, data mulai dihitung untuk auto-anonimisasi)
```

- **`SUSPENDED`**: pengguna langsung ter-_logout_ dari semua sesi (family refresh token dicabut), tidak bisa login sampai dipulihkan.
- **`TERMINATED`**: sama dengan SUSPENDED **plus** memicu counter retensi. Setelah `terminatedUserAnonymizeDays` (lihat §12), data dianonimkan otomatis.

### 3.3 Assign / Ganti Supervisor

1. Buka detail karyawan → **Ubah Supervisor**.
2. Pilih supervisor baru (harus di tenant yang sama, `role ∈ {SUPERVISOR, HR_MANAGER}`).
3. `AuditLog(USER_REASSIGN_SUPERVISOR)` mencatat perubahan.
4. Semua pengajuan cuti/lembur/timesheet **yang belum diapprove** langsung dialihkan ke supervisor baru; yang sudah diapprove tidak diubah (immutable).

### 3.4 Reset Password (Admin Override)

1. Detail karyawan → **Reset Password**.
2. Konfirmasi via dialog. Sistem:
   - Mengganti `passwordHash` dengan token 1x pakai.
   - Set `mustChangePassword=true`.
   - Revoke seluruh sesi user.
   - Kirim email link reset (berlaku 1 jam).
3. `AuditLog(USER_PASSWORD_RESET_BY_ADMIN)` dicatat.

### 3.5 Impersonate (Super Admin)

_Fitur ini di-audit ketat; hanya untuk troubleshooting eskalasi._

1. `/admin/users/{id}` → **Impersonate**.
2. Ketik alasan (wajib, minimum 20 karakter).
3. Sesi baru dibuat dengan flag `impersonatedById=<super-admin-id>`. Semua request selama sesi impersonate menulis dua kolom aktor di audit log (`actorId`, `onBehalfOfId`).
4. Klik **Akhiri Impersonate** untuk kembali.

---

## 4. Struktur Organisasi

### 4.1 Departemen

**Rute:** `/admin/departments`.

- Struktur _flat_ (belum multi-level di v1). Setiap karyawan wajib punya `departmentId`.
- Menghapus departemen ditolak bila masih ada karyawan aktif. Reassign dulu.

### 4.2 Shift

**Rute:** `/admin/shifts`.

Tipe shift yang didukung:

| Tipe       | Karakteristik                                                       | Contoh Use-case       |
| ---------- | ------------------------------------------------------------------- | --------------------- |
| `STATIC`   | Jam tetap `08:00 – 17:00` setiap hari kerja                         | Kantor pusat          |
| `FLEXIBLE` | Rentang toleransi (mis. clock-in 07:00–10:00, minimum durasi 8 jam) | Software team         |
| `ROTATING` | Pola shift mingguan yang berputar                                   | Operasional shift 3x8 |

Setiap shift wajib dikaitkan ke **satu atau lebih geofence** (kantor mana yang valid untuk shift ini).

### 4.3 Geofence

**Rute:** `/admin/geofences`.

#### 4.3.1 Fields

| Field                                   | Wajib? | Default         | Deskripsi                                                                                                                                                                             |
| --------------------------------------- | ------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nama Lokasi                             | ✅     | —               | Ditampilkan di dropdown Shift & audit log.                                                                                                                                            |
| Latitude / Longitude                    | ✅     | Monas (Jakarta) | WGS84 dalam derajat desimal, 7 angka di belakang koma (~10 cm).                                                                                                                       |
| Radius                                  | ✅     | 100 m           | 5–5000 m. Rekomendasi: 30–100 m kantor kecil, 200–500 m pabrik.                                                                                                                       |
| Batas akurasi GPS (`maxAccuracyMeters`) | ❌     | `null` (off)    | 10–500 m. Jika aktif, clock-in dengan `accuracyMeters` lebih buruk dari ini ditolak dengan `WEAK_GPS_ACCURACY`. Mencegah device yang IP-geolokasi lolos.                              |
| Wi-Fi SSID allowlist (`allowedSsids`)   | ❌     | `[]` (off)      | Sampai 10 SSID. Bila **mobile app** melaporkan salah satu, clock-in diterima meski GPS di luar radius. Fallback indoor untuk gedung GPS-hostile. Browser tidak dapat memberikan SSID. |

#### 4.3.2 Interactive Map Picker (baru — 2026-08-06, rev 2026-08-07)

Form geofence sekarang punya peta interaktif:

1. **Klik peta** atau **seret pin** untuk memindahkan pusat geofence.
2. Tombol **📍 lokasi saya** — pakai geolokasi browser (perlu HTTPS/localhost).
3. Kotak **Cari alamat** — powered by Nominatim (OSM), diproksi melalui endpoint
   `/maps/geocode` di API Workpulse. Contoh: "Sudirman Central", "Menara BCA".
4. **Template picker** — tombol pintasan untuk Sudirman, SCBD, Kuningan, Thamrin, Menteng.

Peta sekarang memakai **MapLibre GL JS + PMTiles self-hosted** — semua tile disajikan
dari MinIO milik Workpulse via endpoint `/maps/*` (lihat
[ADR-0042](./ADR/ADR-0042-self-hosted-map-tiles.md) dan
[runbook MAP-BOOTSTRAP](./OPS/MAP-BOOTSTRAP.md)). Attribution `© OpenStreetMap
contributors` tetap ditampilkan sesuai lisensi ODbL. Ops harus menjalankan runbook
seed sekali sebelum flip `MAPS_ENABLED=true` — kalau lupa, form geofence akan
menampilkan kartu "Peta belum tersedia" dan lat/lng masih bisa diketik manual.

#### 4.3.3 Server-side validation stack

Setiap clock-in / clock-out dievaluasi server dalam urutan:

1. **Accuracy budget** — bila `maxAccuracyMeters` aktif & `accuracyMeters > threshold` → tolak `WEAK_GPS_ACCURACY`.
2. **Wi-Fi SSID fallback** — bila client kirim `wifiSsid` yang ada di `allowedSsids` → diterima (bypass distance).
3. **Haversine distance** — bila jarak dari pusat > `radiusMeters` → tolak `OUTSIDE_GEOFENCE`.

Urutan penting: accuracy dicek **sebelum** SSID untuk mencegah device yang IP-geolokasi memakai SSID yang bocor.

Semua kolom `AttendanceEvent.distanceMeters` tetap denormalisasi jarak sesungguhnya walaupun akses lewat SSID — HR bisa lihat "SSID granted tapi 3 km jauh" di Geofence Health nanti.

### 4.4 Assign Shift & Geofence ke Karyawan

Ada 2 cara:

1. **Per karyawan** — di detail karyawan, tab "Jadwal".
2. **Massal per departemen** — dari `/admin/departments/{id}`, tombol **Assign Shift**, akan meng-_override_ shift semua anggota kecuali yang telah dikustom individual.

---

## 5. Konfigurasi Kehadiran

### 5.1 Correction Request (Koreksi Kehadiran)

**Alur:**

```
Employee (isi form correction, upload bukti opsional)
   ↓
Supervisor (approve / reject)
   ↓
HR (jika supervisor absen > 24 jam, klaim & putuskan)
```

- HR bisa **membuka kembali** koreksi yang sudah disetujui via `/admin/attendance/corrections/{id}` → **Reopen**, dibatasi 7 hari sejak approval. Aksi ini teraudit.
- **Invariant:** meng-approve koreksi TIDAK mengedit baris `AttendanceRecord` lama; sistem menandai record dengan `correctedById` menunjuk ke baris koreksi baru. Historis original tetap terjaga.

### 5.2 Rekap Kehadiran Tim (Supervisor / HR)

Rute:

- `/attendance` untuk view individu.
- `/admin/analytics` (Executive Dashboard) untuk view tenant.

Filter yang tersedia: rentang tanggal, departemen, status (`ON_TIME`, `LATE`, `EARLY_LEAVE`, `NO_SHOW`).

---

## 6. Konfigurasi Cuti

**Rute:** `/admin/leave-types`.

### 6.1 Buat Tipe Cuti

Bidang:

| Bidang                                                               | Keterangan                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `code`                                                               | Kode unik per tenant (mis. `ANNUAL`, `SICK`, `MATERNITY`)                             |
| `label`                                                              | Label yang tampil ke user                                                             |
| `defaultQuotaDays`                                                   | Kuota tahunan default per karyawan                                                    |
| `accrualType`                                                        | `UPFRONT` (langsung penuh awal tahun) atau `MONTHLY` (proporsional per bulan bekerja) |
| `carryOverEnabled` + `carryOverMaxDays` + `carryOverExpiresInMonths` | Aturan sisa saldo tahun sebelumnya                                                    |
| `requiresAttachment`                                                 | Wajib upload dokumen (misal cuti sakit di atas 2 hari)                                |
| `probationEligible`                                                  | Bisa diambil selama masa probation atau tidak                                         |
| `advanceRequiredDays`                                                | Wajib diajukan minimum N hari sebelumnya                                              |
| `paid`                                                               | Berdampak pada payroll (kalau ada integrasi)                                          |

### 6.2 Adjust Balance (Manual)

Kadang HR perlu menyesuaikan saldo (mis. koreksi migrasi data lama, kompensasi lembur, pengurangan karena disiplin).

1. `/admin/users/{id}` → tab **Saldo Cuti** → **Sesuaikan**.
2. Pilih tipe cuti, delta (+/-), alasan (wajib, ≥ 20 karakter).
3. Sistem menulis baris `LeaveBalanceAdjustment` + `AuditLog(LEAVE_BALANCE_OVERRIDE)` di transaksi yang sama.
4. **Tidak bisa diedit setelah tersimpan.** Perlu koreksi? Buat adjustment kedua yang membalikkan.

### 6.3 Public Holiday (Hari Libur)

**Rute:** `/admin/holidays`.

- Tambah manual atau import CSV.
- Hari libur mempengaruhi:
  - Perhitungan working-days untuk cuti.
  - Rate lembur (`PUBLIC_HOLIDAY` multiplier).
  - Timesheet expected hours.

---

## 7. Konfigurasi Lembur

**Rute:** `/admin/company` → tab **Lembur**.

### 7.1 Rate Multiplier

| Kategori       | Default | Sumber              |
| -------------- | ------- | ------------------- |
| Weekday        | 1.5×    | Rate dasar karyawan |
| Weekend        | 2.0×    | Rate dasar karyawan |
| Public Holiday | 3.0×    | Rate dasar karyawan |

Rate dasar per karyawan = `overtimeHourlyRate` di record User. **Server** yang menghitung; klien hanya menampilkan estimasi.

### 7.2 Cap Harian & Bulanan

- Maks. jam lembur/hari (mis. 4 jam)
- Maks. jam lembur/bulan (mis. 40 jam)
- Bila diajukan melebihi cap → API menolak dengan `OVERTIME_CAP_EXCEEDED`.

### 7.3 Pre-approval vs Post-approval

- **Pre-approval:** karyawan mengajukan sebelum kerja. Bila diapprove, jam dijamin masuk timesheet.
- **Post-approval:** karyawan input setelah kerja, dengan waktu masuk-keluar aktual. HR bisa membatasi ke role tertentu (mis. hanya untuk lapangan).

---

## 8. Timesheet — Generate, Approval, Ekspor

### 8.1 Konfigurasi Periode

**Rute:** `/admin/timesheet/config`.

- **Periode:** `BIWEEKLY` (14 hari) atau `MONTHLY` (bulan kalender).
- **Cut-off day:** tanggal potong bulanan (contoh: 25).
- **Auto-generate:** toggle apakah scheduler harian meng-generate otomatis di hari cut-off.

### 8.2 Generate Periode

**Rute:** `/admin/timesheet` → **Generate periode berjalan**.

Aksi ini akan:

1. Menghitung agregat `AttendanceRecord + LeaveRequest(APPROVED) + OvertimeRequest(APPROVED)` per karyawan untuk periode berjalan.
2. Membuat baris `Timesheet` status `DRAFT` per karyawan (idempoten — kalau sudah ada, tidak duplikat).
3. Mengirim notifikasi ke semua karyawan supaya mereka meninjau data.

### 8.3 Approval Chain

```
DRAFT (auto/manual generate)
   ↓ Employee klik "Konfirmasi"
SUBMITTED
   ↓ Supervisor approve/reject
APPROVED_L1        REJECTED (kembali ke DRAFT, disertai alasan)
   ↓ HR approve/reject
APPROVED_L2
   ↓ HR lock (opsional)
LOCKED (final, hanya bisa reopen oleh HR)
```

- Reject di level manapun menjatuhkan timesheet ke `DRAFT` — karyawan wajib memperbaiki (koreksi kehadiran, sinkron cuti/lembur) lalu re-submit.
- HR bisa **Reopen** timesheet yang sudah `LOCKED` bila ada temuan post-hoc. Wajib alasan; teraudit.

### 8.4 Ekspor Timesheet

**Rute:** `/admin/timesheet/exports`.

Filter: rentang tanggal, departemen, status.

Format:

- **CSV** (untuk payroll import)
- **PDF** (untuk arsip)
- **Excel (XLSX)** — dengan pivot per departemen

Riwayat ekspor disimpan; setiap ekspor menulis `AuditLog(TIMESHEET_EXPORT)` dan file di-_sign_ dengan URL sementara (default 24 jam).

---

## 9. Approval Backlog & Delegasi

**Rute:** `/admin/approvals-backlog`.

Halaman ini menggabungkan **semua item menunggu** lintas modul (cuti, lembur, timesheet, correction). Digunakan oleh HR untuk:

- **Klaim** item yang bertahan lebih dari SLA (mis. > 48 jam) — biasanya karena supervisor sedang cuti.
- **Delegasi sementara** — set `supervisorDelegateId` di record User selama supervisor cuti; sistem otomatis merutekan ke delegate.

Kolom `Aging` menandai warna kuning (>24h), merah (>48h).

---

## 10. Analytics & Laporan

### 10.1 Executive Dashboard

**Rute:** `/admin/analytics`.

Tile utama:

- **Kehadiran hari ini** (present / late / no-show)
- **Backlog approval** (cuti/lembur/timesheet)
- **Tren keterlambatan 30 hari**
- **Distribusi jam lembur per departemen**
- **Utilization** (jam kerja aktual vs kontrak)

### 10.2 Laporan Standar

**Rute:** `/admin/reports`.

Katalog laporan built-in:

- Rekap Kehadiran Bulanan
- Ringkasan Cuti Tahunan (per tipe cuti)
- Rekap Lembur (dengan biaya)
- Absensi & Late Comer
- Turnover per Departemen

Semua bisa di-_schedule_ di `/admin/reports/schedules` (daily / weekly / monthly, kirim ke email HR).

### 10.3 Custom Report

**Rute:** `/admin/reports/custom`.

Wizard 3 langkah:

1. Pilih _dataset_ (kehadiran, cuti, lembur, timesheet).
2. Tarik kolom + filter + group-by.
3. Preview, simpan sebagai template, atau jalankan langsung.

---

## 11. Compliance — ROPA, DPIA, Retensi, Vendor

### 11.1 Record of Processing Activities (ROPA)

**Rute:** `/admin/ropa`.

Daftar aktivitas pengolahan data pribadi (dasar hukum PDP UU 27/2022). Untuk tiap aktivitas:

- Kategori data (identitas, kesehatan, lokasi, dsb.)
- Tujuan
- Dasar hukum (`CONSENT`, `CONTRACT`, `LEGAL_OBLIGATION`, ...)
- Retensi
- Penerima data (internal / vendor)
- Transfer lintas negara (ya/tidak)

Field yang boleh diubah HR terbatas — kolom fundamental (kategori data + dasar hukum) di-_lock_ setelah DPIA disetujui.

### 11.2 DPIA (Data Protection Impact Assessment)

**Rute:** `/admin/dpia`.

Untuk aktivitas berisiko tinggi (mis. profiling, monitoring lokasi). Template DPIA memandu HR menilai:

- Risiko privasi (skala 1–5)
- Mitigasi
- Konsultasi ke DPO (kalau ada)
- Tanggal review berikutnya

### 11.3 Retensi Data

**Rute:** `/admin/privacy/retention`.

Parameter tenant-wide:

| Field                             | Rentang | Default | Efek                                                                                     |
| --------------------------------- | ------- | ------- | ---------------------------------------------------------------------------------------- |
| `notificationRetentionDays`       | 0–365   | 30      | Job harian 02:00 UTC menghapus notifikasi lebih tua dari N hari. `0` = simpan selamanya. |
| `dataExportArchiveRetentionHours` | 1–168   | 72      | Arsip file DSAR user auto-hapus setelah N jam                                            |
| `terminatedUserAnonymizeDays`     | 0–1825  | 365     | User TERMINATED > N hari akan dianonimkan otomatis. `0` = nonaktif.                      |

Perubahan hanya berlaku pada job berikutnya (bukan retroaktif).

### 11.4 Vendor Register

**Rute:** `/admin/privacy/vendors`.

Daftar pihak ketiga yang mengakses data pribadi (payroll, insurance, cloud). Untuk tiap vendor: nama, jenis kontrak DPA (data processing agreement), tanggal audit, tingkat risiko.

---

## 12. Kebijakan Privasi & Consent

**Rute:** `/admin/privacy/policies`.

### 12.1 Terbitkan Versi Baru

1. Klik **Terbitkan versi baru**.
2. Isi _version label_ (mis. `2026-01`), judul, dan isi (mendukung Markdown).
3. Set **effective date** (default sekarang; bisa mendatang untuk staging).
4. Klik **Terbitkan**.
5. Sistem:
   - Menyimpan baris `PrivacyPolicy`.
   - Menandai **semua user aktif** dengan `pendingConsent` (kecuali yang sudah pernah menerima versi yang sama).
   - Login berikutnya akan meng-_force_ user ke halaman `/consent` sampai mereka menerima.
   - HR sendiri juga terkena aturan ini — Anda mungkin di-redirect setelah publish.

### 12.2 Riwayat & Rollback

- Versi kebijakan **tidak bisa diedit**. Untuk perubahan, terbitkan versi baru.
- Rollback dilakukan dengan menerbitkan ulang isi lama sebagai versi berikutnya (audit trail tetap lurus).

---

## 13. Permintaan Penghapusan Data (Right to Erasure)

**Rute:** `/admin/privacy/erasure-requests`.

### 13.1 Alur

```
User mengajukan (dari /settings/privacy)
   ↓
Status: PENDING
   ↓  HR review
APPROVED (scheduled)
   ↓  Job harian menghapus / anonimkan
COMPLETED       REJECTED (alasan wajib) — user diberi tahu
```

### 13.2 Aksi HR

- **Approve** → wajib menetapkan `scheduledFor` (default T+7 hari, untuk grace period).
- **Reject** → wajib alasan (mis. "kontrak aktif, retensi legal 5 tahun").
- **Cancel** → hanya bisa dilakukan user sendiri sebelum `scheduledFor` tiba.

### 13.3 Yang Dihapus vs Yang Dianonimkan

| Data                            | Aksi                                                                        |
| ------------------------------- | --------------------------------------------------------------------------- |
| Nama, email, foto profil        | Dihapus / diganti hash                                                      |
| Riwayat kehadiran, cuti, lembur | Dianonimkan (`userId` diganti UUID sintetis; agregat statistik tetap)       |
| Audit log                       | **Tidak dihapus** — kepatuhan regulasi mewajibkan retensi audit             |
| Backup                          | Dihapus siklus backup berikutnya (7 hari) — tercatat di laporan penghapusan |

Laporan hasil penghapusan tersedia di `/admin/privacy/retention/audit-reports`.

---

## 14. Breach Ledger

**Rute:** `/admin/security/breaches`.

Registri insiden keamanan / kebocoran data. Bidang:

- Tanggal deteksi, tanggal notifikasi ke otoritas, tanggal notifikasi ke subjek.
- Klasifikasi (confidentiality / integrity / availability).
- Estimasi jumlah data subject terdampak.
- Root cause & mitigasi.
- Attachment (laporan investigasi PDF).

Entri di-**lock** setelah 30 hari; koreksi butuh Super Admin + alasan.

---

## 14a. Kebijakan Keamanan Tenant (MFA Toggle)

**Rute:** `/admin/security` — **SUPER_ADMIN saja**.

Halaman ini menampung semua kebijakan keamanan yang berlaku di seluruh tenant Anda. Perubahan berefek **real-time (≤30 detik)** tanpa restart API dan tercatat di audit log dengan action `SECURITY_POLICY_UPDATED`.

### 14a.1 Toggle "Paksa enroll MFA untuk HR & Super Admin"

| Kondisi               | Efek                                                                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OFF** (default MVP) | MFA opsional. HR & Super Admin dapat login tanpa faktor kedua. Setiap user tetap bisa mengaktifkan MFA secara sukarela lewat `/settings/security` dan setelah enroll, mereka **selalu** ditantang di tiap login.             |
| **ON**                | Semua HR Manager & Super Admin yang **belum mengenrol MFA** langsung diarahkan ke `/setup-mfa` pada request berikutnya, dan tidak dapat mengakses rute lain sampai enrol selesai. Pengguna yang sudah enrol tidak terdampak. |

### 14a.2 Checklist sebelum mengaktifkan

1. Kirim pemberitahuan ke semua HR/Super Admin (minimum 24 jam sebelumnya).
2. Bagikan panduan setup authenticator app (Google Authenticator, Authy, 1Password, atau Bitwarden — semua RFC 6238-compatible).
3. Pastikan tim IT-support siap menangani pertanyaan enrolment.
4. Konfirmasi bahwa `hr@` on-call punya backup codes atau alternatif akses.

### 14a.3 Audit trail

Setiap flip toggle menghasilkan satu baris `audit_logs`:

```
action:      SECURITY_POLICY_UPDATED
entityType:  SecurityPolicy
entityId:    <id>
actorId:     <SUPER_ADMIN yang mengubah>
beforeJson:  { "mfaEnforceHighPrivileged": false }
afterJson:   { "mfaEnforceHighPrivileged": true }
```

Filter di `/admin/audit-log` dengan `action=SECURITY_POLICY_UPDATED` untuk melihat seluruh riwayat.

### 14a.4 Env `MFA_ENFORCE_HR_ADMIN` (legacy)

Env ini kini hanya digunakan **saat pertama kali** tenant di-bootstrap (menetapkan nilai awal toggle). Setelah row `SecurityPolicy` ada di DB, env diabaikan — DB otoritatif. Cara mengecek: buka `/admin/security` — status yang ditampilkan di halaman selalu benar.

---

## 15. Webhook & Integrasi

**Rute:** `/admin/webhooks`.

### 15.1 Registrasi Endpoint

1. Klik **Tambah Webhook**.
2. Isi URL target (harus HTTPS di production), secret (untuk HMAC signature), event yang di-_subscribe_.
3. Sistem mengirim event percobaan (`webhook.test`) untuk memverifikasi endpoint hidup.

### 15.2 Event yang Tersedia

- `leave.approved`, `leave.rejected`
- `overtime.approved`, `overtime.rejected`
- `timesheet.locked`
- `user.terminated`
- `attendance.correction_approved`

### 15.3 Signing

Setiap payload disertakan header `X-Workpulse-Signature: sha256=<hex>`, dihitung dari `HMAC-SHA256(secret, raw_body)`. Endpoint penerima wajib memvalidasi sebelum memproses.

### 15.4 Retry & Dead Letter

- 5x retry dengan exponential back-off (max 24 jam).
- Setelah 5 kegagalan, event dipindah ke Dead Letter Queue di `/admin/webhooks/{id}/dlq`.

---

## 16. Audit Log & Immutability

**Rute:** `/admin/audit-log`.

- **Read-only** dari UI — bahkan Super Admin tidak bisa edit/delete (level DB `REVOKE UPDATE, DELETE`).
- Filter: aktor, entitas, action, rentang waktu, IP.
- Ekspor CSV (dibatasi 100k baris per ekspor, di-audit sendiri).

Setiap baris memuat:

- `actorId`, `onBehalfOfId` (kalau impersonate), `role`, `ip`, `userAgent`.
- `action` (`LEAVE_APPROVE`, `USER_CREATE`, dst.).
- `entityType` + `entityId`.
- Snapshot `before` & `after` (JSON).

---

## 17. Penggunaan API (Quota, Throttling)

**Rute:** `/admin/usage`.

Menampilkan:

- Total request 30 hari, per endpoint.
- Rate-limit hits (kalau ada endpoint yang sering di-throttle → mungkin ada integrasi salah konfigurasi).
- Latency P50/P95/P99 per endpoint.

Batas default:

- `/auth/login`: 5/menit per IP
- `/auth/refresh`: 30/menit per IP
- API umum authenticated: 300/menit per user

---

## 18. Super Admin — Manajemen Tenant

**Rute:** `/admin/companies` (hanya `SUPER_ADMIN`).

### 18.1 Suspend Tenant

- Set `Company.status = SUSPENDED`.
- Semua login user di tenant tersebut ditolak.
- Data tidak dihapus; billing / kontrak dihentikan.

### 18.2 Migrasi Data Antar-tenant

Fitur ini tidak tersedia di UI (risiko integritas). Dilakukan via _runbook_ dengan Super Admin + engineer di _maintenance window_.

---

## 19. Runbook Insiden

### 19.1 Karyawan tidak bisa clock-in ("OUTSIDE_GEOFENCE")

1. Konfirmasi lokasi geofence via `/admin/geofences`.
2. Cek radius (mungkin terlalu kecil untuk akurasi GPS).
3. Cek shift karyawan — apakah geofence itu memang assigned ke shift-nya.
4. Jika benar user salah lokasi, ajarkan mereka meng-_correct_ via correction request.

### 19.2 Saldo Cuti Salah Setelah Import

1. Cek `LeaveBalanceAdjustment` untuk karyawan tersebut (di detail user).
2. Bila hasil migrasi, buat adjustment koreksi (jangan edit balance langsung — semua perubahan lewat adjustment).

### 19.3 Timesheet Tidak Ter-generate

1. Cek `/admin/timesheet/config` — apakah auto-generate aktif dan cut-off hari ini.
2. Cek `AuditLog(TIMESHEET_SCHEDULER_RUN)` — apakah scheduler jalan.
3. Fallback: klik manual **Generate periode berjalan**.

### 19.4 Webhook Terus Gagal

1. Buka `/admin/webhooks/{id}` — cek DLQ.
2. Verifikasi signature di sisi endpoint (kemungkinan besar mismatch secret).
3. Kirim ulang dari DLQ setelah endpoint diperbaiki.

### 19.5 Login Diblokir "TOO_MANY_ATTEMPTS"

- Aktor: cek `/admin/audit-log` filter action=`AUTH_LOGIN_FAIL`, `entityId=<userId>`.
- Bila brute-force nyata → suspend user, forensik.
- Bila false positive → cabut throttle manual: `/admin/users/{id}` → **Clear Rate Limits**.

---

## Lampiran A — Ringkasan RBAC per Rute

| Rute                                                                                                                                 | Peran Terendah |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| `/attendance`, `/leave`, `/overtime`, `/me/timesheet`                                                                                | `EMPLOYEE`     |
| `/leave/approvals`, `/overtime/approvals`                                                                                            | `SUPERVISOR`   |
| `/admin/timesheet`, `/admin/timesheet/config`, `/admin/timesheet/exports`                                                            | `HR_MANAGER`   |
| `/admin/users`, `/admin/departments`, `/admin/geofences`, `/admin/shifts`, `/admin/leave-types`, `/admin/holidays`, `/admin/company` | `HR_MANAGER`   |
| `/admin/analytics`, `/admin/reports/**`, `/admin/usage`                                                                              | `HR_MANAGER`   |
| `/admin/ropa`, `/admin/dpia`, `/admin/privacy/**`, `/admin/security/breaches`                                                        | `HR_MANAGER`   |
| `/admin/webhooks`, `/admin/audit-log`                                                                                                | `HR_MANAGER`   |
| `/admin/companies` (Tenant)                                                                                                          | `SUPER_ADMIN`  |

## Lampiran B — Kanal Notifikasi

| Kejadian                       | In-app         | Email          |
| ------------------------------ | -------------- | -------------- |
| Cuti diajukan                  | ✔ (supervisor) | ✔ (supervisor) |
| Cuti diapprove/reject          | ✔ (pemohon)    | ✔ (pemohon)    |
| Timesheet ter-generate         | ✔ (semua user) | —              |
| Kebijakan privasi baru         | ✔ (semua user) | ✔ (semua user) |
| Erasure request status berubah | ✔ (pemohon)    | ✔ (pemohon)    |
| Webhook gagal berulang         | ✔ (HR)         | ✔ (HR)         |

Preferensi user dapat mem-_mute_ kanal tertentu di `/settings/notifications`, kecuali kategori "hukum & keamanan" (privasi, breach, MFA) yang wajib.
