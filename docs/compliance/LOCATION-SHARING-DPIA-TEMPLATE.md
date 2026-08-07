# DPIA + RoPA Template — Location Sharing During Shift (ADR-0041)

Before a tenant SUPER_ADMIN can flip `SecurityPolicy.locationSharingEnabled = true`,
two compliance artefacts **MUST** exist in Workpulse:

1. A **RoPA activity** with slug `location-sharing` (created via
   `/admin/ropa`).
2. A **DPIA row** attached to that activity, status `APPROVED`, created
   via `/admin/dpia`.

The server enforces both gates:

- `DPIA_ACTIVITY_MISMATCH` (400) if the DPIA's parent RoPA activity has any
  slug other than `location-sharing`.
- `DPIA_NOT_APPROVED` (400) if the DPIA status is `DRAFT` / `IN_REVIEW` /
  `REJECTED` / `RETIRED`.
- `CONSENT_COPY_STALE` (400) if the SHA the admin submits does not match
  `LOCATION_SHARING_CONSENT_COPY.id` in `@workpulse/shared-types`.

This document is a **fill-in template** — Legal / DPO copies the sections
below into the Workpulse UI when creating the row. Do not commit tenant-
specific content into git; keep this template abstract.

---

## RoPA activity template

| Field                  | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
| Slug (immutable)       | `location-sharing`                                             |
| Nama aktivitas         | Berbagi Lokasi On-Demand saat Shift Aktif                      |
| Data controller        | `<Nama badan hukum tenant>`                                    |
| Data processor         | Workpulse SaaS (subprocessor: hosting, email SMTP)             |
| Kategori data subjek   | Karyawan lapangan (`User.isFieldWorker = true`)                |
| Kategori data          | Geolokasi (lat, lng, akurasi), metadata request (siapa/kapan)  |
| Tujuan pemrosesan      | Koordinasi lapangan, verifikasi kehadiran di lokasi klien      |
| Basis hukum (UU PDP)   | Persetujuan (Pasal 20 UU 27/2022)                              |
| Recipient (internal)   | Supervisor pengirim, HR, SUPER_ADMIN (audit)                   |
| Recipient (eksternal)  | Tidak ada                                                      |
| Transfer lintas negara | Tidak ada (data disimpan di region tenant)                     |
| Retensi                | LocationPing: 7 hari · LocationShareRequest: 90 hari · AuditLog: mengikuti policy tenant |
| Safeguards teknis      | Enkripsi at-rest (RDS/Neon), TLS 1.3 in-transit, RBAC, audit log immutable |
| Owner internal         | `<Nama DPO tenant>`                                            |

---

## DPIA template

### Deskripsi pemrosesan (Section 1)

> Supervisor mengirim satu permintaan lokasi kepada karyawan lapangan yang
> telah memberi persetujuan tertulis. Karyawan menerima notifikasi in-app +
> email pada tiga event: permintaan masuk, koordinatnya dilihat, dan
> perubahan consent-nya sendiri. Karyawan bebas menerima atau menolak setiap
> permintaan tanpa konsekuensi terhadap penilaian kerja. Tidak ada
> background tracking; satu permintaan = satu koordinat = satu titik waktu.

### Penilaian risiko (Section 2)

| Risiko                                            | Likelihood | Impact | Mitigasi                                                                                       |
| ------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------- |
| Silent tracking oleh supervisor curang            | Low        | High   | Transparency notif wajib, tidak dapat dinonaktifkan. Setiap view tercatat di audit + user notif. |
| Data leak lewat backup > 7 hari                   | Low        | Medium | Purge worker + backup retention harus ≤ retention DPIA (dokumentasikan di OPS/BACKUP-RESTORE).  |
| Konsentrasi kekuatan (supervisor spam request)    | Medium     | Low    | Kuota 6/user/24h, quota diaudit dan dapat disesuaikan tenant admin.                             |
| Karyawan opt-in di bawah tekanan atasan           | Medium     | Medium | Copy persetujuan menyatakan "tanpa konsekuensi kerja", opt-out anytime, HR pathway di /help.    |
| Coercion via HR menandai `isFieldWorker` sepihak  | Low        | Medium | Perubahan `User.isFieldWorker` di-audit di `USER_UPDATED`; opt-in tetap wajib.                  |

### Alternatif yang dipertimbangkan (Section 3)

- Silent GPS tracking (rejected — melanggar Pasal 20 UU PDP: no consent).
- Continuous polling (rejected — proporsi berlebih vs tujuan koordinasi).
- Wi-Fi SSID beacon fallback (already exists di ADR-0040 Tier-2; tidak
  mendeteksi individu, cukup untuk verifikasi kehadiran).

### Keputusan (Section 4)

> Menerima pemrosesan dengan syarat: fitur hanya boleh diaktifkan per
> tenant setelah persetujuan Legal atas copy versi
> `LOCATION_SHARING_CONSENT_COPY.id`. Retensi kaku (7d ping, 90d
> request). Review kembali dalam 12 bulan atau setelah revisi copy.

### Approval

- Reviewer: `<Nama DPO>`, `<tanggal>`
- Status di sistem: `APPROVED`
- Consent copy SHA yang dilampirkan: `<paste from LOCATION_SHARING_CONSENT_COPY.id>`
