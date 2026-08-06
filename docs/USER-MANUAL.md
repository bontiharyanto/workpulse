# Panduan Pengguna — Workpulse

> **Audiens:** Karyawan (Employee) & Atasan (Supervisor).
> **Perangkat:** Desktop atau mobile browser terkini (Chrome, Safari, Edge, Firefox).
> **Bahasa antarmuka:** Bahasa Indonesia.
> **Dokumen terkait:** [`ADMIN-GUIDE.md`](./ADMIN-GUIDE.md) untuk HR/Admin, [`UAT-E2E.md`](./UAT-E2E.md) untuk QA.

Panduan ini membantu Anda menggunakan Workpulse untuk aktivitas harian: mencatat kehadiran, mengajukan cuti/lembur, memeriksa timesheet, dan mengelola pengaturan pribadi. Fitur atasan (approval) ada di bab tersendiri.

---

## Daftar Isi

1. [Masuk & Ganti Password Pertama](#1-masuk--ganti-password-pertama)
2. [Verifikasi Dua Langkah (MFA)](#2-verifikasi-dua-langkah-mfa)
3. [Menerima Kebijakan Privasi](#3-menerima-kebijakan-privasi)
4. [Beranda & Navigasi](#4-beranda--navigasi)
5. [Kehadiran (Clock-in / Clock-out)](#5-kehadiran-clock-in--clock-out)
6. [Ajukan Cuti](#6-ajukan-cuti)
7. [Ajukan Lembur](#7-ajukan-lembur)
8. [Timesheet Saya](#8-timesheet-saya)
9. [Notifikasi](#9-notifikasi)
10. [Pengaturan Pribadi](#10-pengaturan-pribadi)
11. [Privasi Data (Ekspor & Hapus)](#11-privasi-data-ekspor--hapus)
12. [Fitur untuk Atasan (Supervisor)](#12-fitur-untuk-atasan-supervisor)
13. [Pertanyaan yang Sering Diajukan](#13-pertanyaan-yang-sering-diajukan)
14. [Kode Kesalahan & Cara Mengatasinya](#14-kode-kesalahan--cara-mengatasinya)

---

## 1. Masuk & Ganti Password Pertama

1. Buka URL yang diberikan HR (contoh `https://workpulse.perusahaan.com`).
2. Masukkan **email perusahaan** dan **kata sandi** yang Anda terima.
3. Sistem akan meminta Anda mengganti password saat login pertama:
   - Minimum 8 karakter, kombinasi huruf besar-kecil, angka, dan simbol.
   - Tidak boleh sama persis dengan 3 password terakhir.
4. Setelah berhasil, Anda diarahkan ke halaman utama.

> **Lupa password?** Klik "Lupa password?" di halaman login. Link reset dikirim ke email dan berlaku 1 jam. Bila email tidak sampai, cek folder Spam atau hubungi HR.

---

## 2. Verifikasi Dua Langkah (MFA)

MFA (Multi-Factor Authentication) melindungi akun Anda dari akses tidak sah dengan meminta kode 6-digit dari aplikasi authenticator selain password.

Di **MVP saat ini, MFA bersifat opsional untuk semua peran** — termasuk HR Manager dan Super Admin. Anda bisa memilih mengaktifkannya sendiri kapan saja lewat **Pengaturan → Keamanan**. Kami sangat menganjurkan HR dan Super Admin untuk mengaktifkan MFA karena akun mereka memiliki akses ke data seluruh tenant.

> **Catatan untuk administrator:** Kebijakan enforcement (wajib / opsional) kini dikontrol dari UI di `/admin/security` (SUPER_ADMIN saja) — bukan env. Bila di masa depan HR/Super Admin memutuskan MFA wajib, cukup flip toggle "Paksa enroll MFA untuk HR & Super Admin" di halaman tersebut. Efek langsung berlaku dalam ~30 detik, tanpa restart API. Lihat [ADR-0017 Revision 2](./ADR/ADR-0017-mfa-totp.md#revision-2--per-tenant-db-toggle-2026-08-06-pm).

### 2.1 Mengaktifkan MFA

1. Buka **Pengaturan → Keamanan** (`/settings/security`).
2. Klik **Aktifkan MFA**.
3. Buka aplikasi *authenticator* (Google Authenticator, Authy, Microsoft Authenticator, 1Password).
4. Pindai QR code yang tampil di layar. Bila tidak bisa memindai, ketik manual kode setup di aplikasi.
5. Masukkan kode 6-digit yang muncul di aplikasi.
6. **Simpan 10 backup codes** yang tampil — cetak atau simpan di password manager. Jangan simpan di email/HP yang sama.

### 2.2 Login dengan MFA

1. Setelah memasukkan email + password, akan tampil layar "Verifikasi MFA".
2. Buka aplikasi authenticator → salin kode 6-digit → tempel di form.
3. Klik **Verifikasi**.

### 2.3 Kehilangan HP dengan Authenticator?

- Gunakan **backup code** — masuk seperti biasa, di layar MFA klik "Gunakan backup code", masukkan salah satu kode 8-digit.
- Setiap backup code hanya bisa dipakai sekali. Setelah dipakai, buka Pengaturan → Keamanan untuk generate set baru.
- Bila semua backup code habis, hubungi HR untuk reset MFA.

### 2.4 Nonaktifkan MFA

Buka **Pengaturan → Keamanan → Nonaktifkan MFA**. Perlu password Anda + kode TOTP saat ini.

> **Bila administrator (SUPER_ADMIN)** mengaktifkan toggle "Paksa enroll MFA" di `/admin/security`, tombol nonaktif MFA otomatis di-disable untuk peran HR / Super Admin.

---

## 3. Menerima Kebijakan Privasi

Bila HR menerbitkan versi kebijakan privasi baru, saat login berikutnya Anda **akan dipaksa** ke halaman `/consent` dan tidak bisa mengakses fitur lain sebelum menerima.

1. Baca isi kebijakan di layar (bisa di-scroll).
2. Centang **"Saya telah membaca dan menyetujui kebijakan privasi versi vX"**.
3. Klik **Terima & lanjutkan**.
4. Anda diarahkan ke Kehadiran seperti biasa.

Riwayat persetujuan tersimpan di **Pengaturan → Privasi data**.

---

## 4. Beranda & Navigasi

Setelah login, Anda diarahkan ke **Kehadiran** sebagai halaman utama. Struktur navigasi:

- **Workspace** (kegiatan harian Anda)
  - Kehadiran
  - Cuti
  - Lembur
  - Timesheet
- **Persetujuan** *(hanya tampil untuk Supervisor/HR)*
  - Approval Cuti
  - Approval Lembur
  - Approval Timesheet
  - Backlog Approval

Menu kanan atas:

- **Notifikasi** (ikon lonceng) — daftar notifikasi in-app.
- **Menu profil** (inisial nama Anda) — akses ke Pengaturan, Ubah Password, Keluar.

**Pencarian cepat:** Tekan `Ctrl + K` (Windows) / `⌘ + K` (Mac) untuk *command palette* — lompat cepat ke halaman apa pun.

---

## 5. Kehadiran (Clock-in / Clock-out)

**Rute:** `/attendance`.

### 5.1 Persiapan Sekali Saja

Saat pertama kali clock-in, browser akan meminta izin **lokasi**. Klik **Izinkan**. Bila Anda menolak, tombol Clock-in akan disabled.

> Perusahaan hanya menerima **koordinat lokasi Anda saat clock-in / clock-out**. Server memvalidasi apakah lokasi masuk area kantor (geofence). Sistem **tidak melacak** lokasi Anda di luar tindakan clock-in/out.

### 5.2 Clock-in

1. Buka halaman Kehadiran.
2. Klik **Clock-in**.
3. Sistem membaca lokasi Anda + membaca shift Anda hari ini.
4. Bila lokasi valid dan waktu masuk sesuai shift:
   - ✅ Kehadiran tercatat, status: `PRESENT` atau `LATE` bila lebih dari toleransi.
5. Bila lokasi di luar geofence:
   - ❌ Muncul pesan "Anda berada di luar area kantor". Pindah lokasi atau ajukan koreksi (§5.5).

### 5.3 Clock-out

Sama seperti clock-in, tetapi tombolnya berubah menjadi **Clock-out** setelah Anda clock-in. Tekan di akhir jam kerja.

- Bila lupa clock-out sampai lewat tengah malam, sistem menutup shift secara otomatis dengan status `NO_CLOCKOUT`; Anda perlu mengajukan koreksi.
- Bila clock-out **sebelum** jam pulang normal → status `EARLY_LEAVE`.

### 5.4 Riwayat Kehadiran

Di halaman `/attendance`, ada tab **Riwayat**. Filter berdasarkan rentang tanggal (default 14 hari terakhir).

Setiap baris menampilkan:

| Kolom | Arti |
|---|---|
| Tanggal | Tanggal shift |
| Clock-in | Waktu masuk aktual + status (tepat / terlambat) |
| Clock-out | Waktu pulang aktual + status |
| Durasi | Jam kerja bersih (setelah dipotong jam istirahat) |
| Lokasi | Nama geofence tempat Anda clock-in |
| Status | `PRESENT`, `LATE`, `EARLY_LEAVE`, `NO_CLOCKOUT`, `ON_LEAVE`, `PUBLIC_HOLIDAY` |

### 5.5 Ajukan Koreksi Kehadiran

Bila ada kesalahan (lupa clock-out, HP habis baterai, sistem down), ajukan koreksi:

1. Di baris kehadiran yang bermasalah, klik **Koreksi**.
2. Isi:
   - Jenis koreksi: `MISSING_CLOCK_IN`, `MISSING_CLOCK_OUT`, `WRONG_TIME`, `WRONG_LOCATION`.
   - Waktu yang benar (bila relevan).
   - Alasan (minimum 10 karakter).
   - Attachment opsional (foto bukti, screenshot).
3. Klik **Kirim**.
4. Supervisor akan menerima notifikasi untuk approve/reject.

**SLA:** Ajukan koreksi maksimal 7 hari dari tanggal kejadian. Setelah itu, sistem menolak.

---

## 6. Ajukan Cuti

**Rute:** `/leave`.

### 6.1 Lihat Saldo Cuti

Di halaman Cuti, panel atas menampilkan saldo per tipe cuti:

| Kolom | Arti |
|---|---|
| Tipe Cuti | Nama tipe (Cuti Tahunan, Cuti Sakit, dsb.) |
| Kuota | Kuota tahun berjalan |
| Terpakai | Sudah diapprove & diambil |
| Pending | Sudah diajukan tapi belum diapprove |
| Sisa | Kuota − Terpakai − Pending |
| Carry-over | Sisa dari tahun sebelumnya (bila tipe cuti mengizinkan) |

### 6.2 Ajukan Cuti

1. Klik **Ajukan cuti**.
2. Pilih **tipe cuti** dari daftar.
3. Pilih **tanggal mulai** dan **tanggal selesai** (dari kalender).
4. Sistem menghitung otomatis **jumlah hari kerja** (menghindari akhir pekan + hari libur nasional).
5. Isi **alasan** (minimum 10 karakter).
6. Bila tipe cuti mewajibkan lampiran (mis. cuti sakit ≥ 2 hari, ada tanda peringatan di form), upload PDF/JPG/PNG (maks 5 MB).
7. Klik **Kirim**.

**Validasi otomatis:**

- Sisa saldo cukup → lanjut.
- Sisa saldo kurang → pesan `INSUFFICIENT_BALANCE`, ajukan lebih pendek atau ubah tipe cuti.
- Tumpang tindih dengan cuti lain yang masih pending/approved → pesan `LEAVE_OVERLAP`.
- Terlambat mengajukan (untuk tipe yang butuh `advanceRequiredDays`) → pesan `ADVANCE_NOTICE_REQUIRED`.

### 6.3 Batalkan Pengajuan

- **Status `PENDING`**: klik **Batalkan** di baris pengajuan. Saldo langsung dikembalikan.
- **Status `APPROVED_L1`** (baru disetujui supervisor): masih bisa dibatalkan sendiri, saldo dikembalikan.
- **Status `APPROVED_L2`** (sudah disetujui HR): tidak bisa dibatalkan sendiri; hubungi HR.

### 6.4 Status Pengajuan

| Status | Arti |
|---|---|
| `PENDING` | Menunggu review Supervisor |
| `APPROVED_L1` | Disetujui Supervisor, menunggu HR |
| `APPROVED_L2` | Disetujui HR — cuti resmi berlaku |
| `REJECTED` | Ditolak; alasan tampil di baris |
| `CANCELLED` | Anda batalkan sendiri |

---

## 7. Ajukan Lembur

**Rute:** `/overtime`.

### 7.1 Pre-approval (Sebelum Kerja)

1. Klik **Ajukan lembur**.
2. Pilih **tanggal** & **jam mulai – selesai** yang direncanakan.
3. Isi **alasan** (minimum 20 karakter — beri konteks bisnis).
4. Klik **Kirim**.
5. Sistem menampilkan **estimasi bayaran** berdasarkan multiplier (weekday / weekend / hari libur).
6. Setelah supervisor + HR approve, jam lembur otomatis masuk timesheet.

### 7.2 Post-approval (Setelah Kerja, Bila Diizinkan)

Bila HR mengizinkan post-approval untuk tim Anda:

1. Klik **Catat lembur (post-hoc)**.
2. Isi tanggal + jam aktual masuk-keluar.
3. Sistem akan meminta bukti (screenshot email, dokumen proyek).
4. Kirim untuk approval.

### 7.3 Batas Lembur

- Maks. per hari: default 4 jam.
- Maks. per bulan: default 40 jam.
- Bila mengajukan melebihi cap → pesan `OVERTIME_CAP_EXCEEDED`. Kurangi jam, atau minta HR untuk exception.

### 7.4 Batal / Edit

Sama seperti cuti — bisa dibatalkan selama status `PENDING` atau `APPROVED_L1`.

---

## 8. Timesheet Saya

**Rute:** `/me/timesheet`.

### 8.1 Kapan Timesheet Tampil?

HR meng-generate timesheet per periode (biasanya bulanan atau dua-mingguan). Setelah di-generate, Anda akan melihat baris periode berjalan di halaman ini.

Bila belum ada baris — pesan "Belum ada timesheet untuk periode ini" muncul. Ini **normal** — hubungi HR bila melewati tanggal cut-off.

### 8.2 Isi Timesheet

Tabel menampilkan per-hari:

| Kolom | Arti |
|---|---|
| Tanggal | Tanggal kalender |
| Shift | Nama shift Anda pada hari itu |
| Kehadiran | Jam kerja aktual (dari clock-in/out) |
| Cuti | Bila hari itu Anda cuti/izin/sakit yang sudah diapprove |
| Lembur | Jam lembur yang sudah diapprove |
| Total | Total jam yang dihitung (kehadiran + lembur) |

Ringkasan di atas tabel: total jam periode, total lembur, total cuti, ketidakhadiran (bila ada).

### 8.3 Konfirmasi Timesheet

1. Review baris per baris. Bila ada yang salah:
   - Kehadiran salah → kembali ke **Kehadiran** → ajukan koreksi. Setelah koreksi diapprove, HR akan me-*refresh* timesheet.
   - Cuti/lembur belum masuk → cek statusnya (mungkin masih pending).
2. Bila semua benar, klik **Konfirmasi timesheet**.
3. Timesheet berpindah status ke `SUBMITTED`. Supervisor lalu HR akan melakukan approval.

### 8.4 Timesheet Ditolak

Bila supervisor/HR reject, alasan tampil di baris. Timesheet kembali ke status `DRAFT`. Perbaiki (koreksi kehadiran atau ajukan cuti retro-aktif) dan submit ulang.

---

## 9. Notifikasi

Ikon lonceng di kanan atas menandai jumlah notifikasi belum dibaca.

Kategori notifikasi:

- **Approval** — cuti/lembur/timesheet/correction Anda di-approve atau reject.
- **Delegasi** — bila Anda diberi tugas approval sementara.
- **Kebijakan & privasi** — versi kebijakan privasi baru, hasil erasure request, dsb.
- **Keamanan** — login dari perangkat baru, MFA berubah, password direset admin.
- **Sistem** — pengumuman umum.

### 9.1 Halaman Notifikasi

Klik lonceng → **Lihat semua** untuk membuka `/notifications`. Filter per kategori, tandai sudah dibaca massal.

### 9.2 Preferensi Notifikasi

**Rute:** `/settings/notifications`.

Anda bisa mematikan notifikasi email untuk kategori tertentu (kecuali "hukum & keamanan" yang wajib). In-app notifikasi selalu aktif.

---

## 10. Pengaturan Pribadi

**Rute:** `/settings/profile`.

- **Profil** — nama lengkap, foto (opsional), nomor telepon darurat.
- **Keamanan** (`/settings/security`) — ubah password, kelola MFA, kelola sesi aktif.
- **Notifikasi** — preferensi kanal.
- **Privasi data** — riwayat consent, ekspor data, hapus data.

### 10.1 Ubah Password

**Rute:** `/change-password`.

1. Masukkan password saat ini.
2. Masukkan password baru (2x konfirmasi).
3. Klik **Simpan**.
4. Semua sesi lain **otomatis logout** (perangkat lain).

### 10.2 Kelola Sesi Aktif

**Rute:** `/settings/security` → panel **Sesi aktif**.

Daftar sesi (perangkat browser) yang saat ini login ke akun Anda. Untuk tiap sesi:

- Perangkat & lokasi (kota, berdasar IP).
- Aktivitas terakhir.
- Tombol **Logout sesi ini** — akan mencabut refresh token; perangkat tersebut langsung ter-logout.

Tombol **Logout semua sesi lain** untuk cabut semua kecuali browser saat ini (berguna bila kehilangan HP atau setelah login di komputer umum).

---

## 11. Privasi Data (Ekspor & Hapus)

**Rute:** `/settings/privacy`.

### 11.1 Ekspor Data Pribadi (DSAR)

1. Klik **Ajukan ekspor data**.
2. Sistem membuat request status `PENDING`.
3. Setelah beberapa menit, status berubah ke `READY` dan tombol **Unduh** muncul.
4. Klik unduh → file ZIP berisi semua data Anda (profil, kehadiran, cuti, lembur, timesheet, audit log, consent history).
5. File tersedia selama 72 jam (default), kemudian dihapus otomatis.

> **Cooldown:** Hanya bisa mengajukan 1x per 7 hari. Bila terlalu cepat → pesan `EXPORT_COOLDOWN`.

### 11.2 Ajukan Penghapusan Data

1. Klik **Ajukan penghapusan data**.
2. Isi alasan (opsional tapi disarankan).
3. Kirim. Status: `PENDING`.
4. HR akan review dalam beberapa hari kerja.
5. **Bila disetujui:** akan ada `scheduledFor` (default T+7 hari) untuk periode *grace*. Anda bisa **Batalkan** selama periode ini.
6. Setelah `scheduledFor` tiba, data dihapus/dianonimkan. Anda akan menerima laporan email.

Data yang dihapus mengikuti aturan yang dijelaskan di [Panduan Admin §13.3](./ADMIN-GUIDE.md#133-yang-dihapus-vs-yang-dianonimkan).

### 11.3 Riwayat Consent

Panel bawah `/settings/privacy` menampilkan semua versi kebijakan privasi yang pernah Anda terima, dengan tanggal & jam persetujuan.

---

## 12. Fitur untuk Atasan (Supervisor)

Bila Anda berperan `SUPERVISOR`, menu **Persetujuan** akan muncul di sidebar.

### 12.1 Approval Cuti

**Rute:** `/leave/approvals`.

Daftar pengajuan tim Anda dengan status `PENDING`. Untuk tiap baris:

- Nama karyawan, tipe cuti, tanggal, alasan, saldo saat ini.
- Tombol **Approve** dan **Reject**.

**Approve:**

- Klik **Approve** → dialog konfirmasi → OK.
- Status berpindah ke `APPROVED_L1`; HR akan approve tahap 2.
- Saldo karyawan **belum dikurangi** (baru dikurangi saat `APPROVED_L2`).

**Reject:**

- Klik **Reject** → wajib isi alasan (≥ 10 karakter).
- Status: `REJECTED`. Karyawan diberi tahu.

### 12.2 Approval Lembur

**Rute:** `/overtime/approvals`.

Sama seperti cuti. Tambahan: sistem menampilkan **estimasi biaya** (jam × rate × multiplier) supaya Anda punya konteks fiskal.

### 12.3 Approval Timesheet

**Rute:** `/admin/timesheet`.

Setelah karyawan konfirmasi timesheet mereka (status `SUBMITTED`), baris muncul di sini. Anda bisa:

- Drill-down ke detail per-hari.
- Approve → status berpindah ke `APPROVED_L1`.
- Reject dengan alasan → kembali ke `DRAFT` karyawan.

### 12.4 Backlog / Delegasi

Bila Anda cuti dan supervisor cadangan tidak di-set, HR bisa **klaim** approval Anda. Untuk mencegah blocking, sebelum cuti panjang set delegate:

1. Buka **Pengaturan → Profil** → **Delegasi persetujuan**.
2. Pilih rekan supervisor.
3. Set periode.
4. Selama periode itu, notifikasi approval Anda otomatis diarahkan ke delegate (tapi Anda tetap CC).

### 12.5 Rekap Tim

**Rute:** `/attendance` → tab **Rekap tim**.

Filter: rentang 7 / 14 / 30 hari. Kolom: nama, present count, late count, no-show, total jam. Berguna untuk retrospektif mingguan.

---

## 13. Pertanyaan yang Sering Diajukan

### Q: Bisakah saya clock-in dari luar kantor (WFH)?

Tergantung kebijakan perusahaan. Bila WFH resmi diakui, HR akan menambahkan geofence khusus WFH (radius besar meliputi rumah Anda) atau menandai hari tertentu sebagai WFH-day (auto-clock-in). Konfirmasi ke HR.

### Q: Kenapa saldo cuti saya tiba-tiba bertambah/berkurang?

- Bertambah tiap awal periode akrual (bulanan/tahunan, tergantung tipe cuti).
- Bertambah bila HR melakukan adjustment (tercatat di **Pengaturan → Privasi data → Riwayat aksi HR**).
- Berkurang saat cuti Anda `APPROVED_L2`.
- Berkurang bila carry-over expired (biasanya 3 bulan setelah tahun baru).

### Q: Bisakah supervisor melihat lokasi saya secara real-time?

Tidak. Sistem hanya menyimpan koordinat saat **clock-in** dan **clock-out**, itupun hanya untuk validasi geofence. Tidak ada tracking real-time.

### Q: Saya lupa clock-out sampai keesokan harinya.

Buka Kehadiran → hari terkait → **Koreksi** dengan jenis `MISSING_CLOCK_OUT`, isi waktu keluar sebenarnya + alasan. Supervisor akan approve.

### Q: Bagaimana bila supervisor tidak approve dalam waktu lama?

Setelah 48 jam, permintaan Anda akan muncul di **Backlog HR**. HR bisa mengambil alih dan approve/reject dari sana.

### Q: Aplikasi lambat / error. Apa yang harus dilakukan?

1. Refresh (F5) browser.
2. Cek indikator status di kanan bawah (bila offline, akan muncul banner).
3. Coba browser lain / mode incognito.
4. Bila masih error, screenshot pesan lengkap & kirim ke IT support dengan menyertakan URL & waktu kejadian.

---

## 14. Kode Kesalahan & Cara Mengatasinya

Bila muncul pop-up merah dengan kode error, cari di tabel ini:

| Kode | Arti | Cara Mengatasi |
|---|---|---|
| `UNAUTHORIZED` | Email/password salah atau sesi kedaluwarsa | Login ulang. Pastikan tidak Caps Lock. |
| `MFA_REQUIRED` | Sesi Anda perlu verifikasi MFA | Lengkapi kode TOTP di layar berikutnya |
| `MUST_CHANGE_PASSWORD` | Password lama masih aktif | Sistem akan mengarahkan ke halaman ganti password |
| `PENDING_CONSENT` | Ada kebijakan privasi baru | Terima kebijakan di halaman `/consent` |
| `OUTSIDE_GEOFENCE` | Lokasi Anda di luar area kantor | Pindah lokasi, atau ajukan koreksi setelah masuk kantor |
| `LOCATION_DENIED` | Browser tidak memberi izin lokasi | Buka settings browser → Izinkan lokasi untuk situs ini |
| `INSUFFICIENT_BALANCE` | Saldo cuti tidak cukup | Kurangi jumlah hari, atau ubah tipe cuti |
| `LEAVE_OVERLAP` | Tanggal cuti tumpang tindih dengan pengajuan lain | Batalkan/edit pengajuan yang tumpang tindih |
| `ADVANCE_NOTICE_REQUIRED` | Ajukan terlalu mendekati tanggal | Ajukan lebih awal (lihat tipe cuti untuk minimum N hari) |
| `OVERTIME_CAP_EXCEEDED` | Melebihi batas lembur harian/bulanan | Kurangi jam, atau minta exception ke HR |
| `THROTTLED` | Terlalu banyak percobaan (biasanya di login) | Tunggu 1 menit, coba lagi. Bila berulang, hubungi HR |
| `SESSION_EXPIRED` | Refresh token kedaluwarsa | Login ulang |
| `EXPORT_COOLDOWN` | Baru saja mengajukan ekspor data | Tunggu sampai 7 hari sejak permintaan sebelumnya |
| `ATTACHMENT_TOO_LARGE` | File > 5 MB | Kompres atau potong file |
| `ATTACHMENT_TYPE_NOT_ALLOWED` | Tipe file tidak diizinkan (hanya PDF/JPG/PNG) | Konversi ke tipe yang didukung |
| `CORRECTION_WINDOW_CLOSED` | Sudah lewat 7 hari sejak tanggal koreksi | Hubungi HR untuk exception |

---

## Lampiran A — Peta Shortcut Keyboard

| Shortcut | Aksi |
|---|---|
| `Ctrl/⌘ + K` | Buka command palette |
| `g` lalu `a` | Ke Kehadiran |
| `g` lalu `l` | Ke Cuti |
| `g` lalu `o` | Ke Lembur |
| `g` lalu `t` | Ke Timesheet |
| `?` | Tampilkan daftar shortcut lengkap |

## Lampiran B — Batas Ukuran Attachment

| Konteks | Batas | Format Diizinkan |
|---|---|---|
| Koreksi kehadiran | 5 MB | JPG, PNG, PDF |
| Cuti (lampiran surat dokter) | 5 MB | JPG, PNG, PDF |
| Lembur (bukti proyek) | 5 MB | JPG, PNG, PDF |
| Foto profil | 2 MB | JPG, PNG |

## Lampiran C — Kontak Bantuan

- **Masalah operasional (cuti, lembur, timesheet):** HR perusahaan Anda.
- **Masalah teknis (aplikasi error, tidak bisa login):** IT support perusahaan Anda.
- **Masalah privasi (right to erasure, kebocoran data):** Data Protection Officer perusahaan / email `dpo@<perusahaan>`.
