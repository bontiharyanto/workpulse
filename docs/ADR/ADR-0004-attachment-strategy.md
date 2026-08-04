# ADR-0004 — Attachment Storage: S3 Presigned URLs

* **Status:** Accepted
* **Date:** 2026-08-02
* **Deciders:** Backend + Frontend leads
* **Supersedes:** —

---

## Context

Karyawan yang mengajukan cuti sakit (`SICK`) di Workpulse **wajib** melampirkan
surat dokter (`LeaveType.requiresAttachment = true`). Ke depan, alur serupa akan
digunakan untuk:

* Lampiran bukti keperluan cuti khusus (surat kematian, akta lahir, dll.).
* Foto profil pengguna.
* Ekspor laporan yang cache di object storage (potensi future work).

Berkas berpotensi berisi **informasi medis** (surat dokter) — sensitif secara
privasi, tidak boleh bocor ke publik / tidak boleh di-scrape lewat URL yang
di-share.

Volume ekspektasi awal: ~50 upload/hari per tenant, ~2 MB rata-rata. Total
100 MB/hari — dapat tumbuh 10x. Streaming langsung lewat backend NestJS akan
menghabiskan bandwidth + CPU node API tanpa perlu.

## Options considered

1. **Upload lewat backend (multipart → server → S3).**
   - **Pros:** Backend dapat validasi konten (magic bytes, virus scan) sebelum
     menyimpan. UX FE lebih sederhana (satu request).
   - **Cons:** Bandwidth backend x2 (client → api → s3). CPU / memory pressure
     pada Node. Sulit di-scale horizontal (satu request bisa berat berjam-jam
     di koneksi lambat).

2. **Presigned PUT langsung dari FE ke S3/MinIO (dipilih).**
   - **Pros:** Bandwidth 0 untuk backend. Skala natural mengikuti bandwidth
     S3. Progress bar akurat via `XMLHttpRequest.upload.onprogress`. Content-
     type + Content-Length **di-signed**, jadi klien tidak bisa upload tipe /
     ukuran lain dari yang di-approve backend.
   - **Cons:** Backend tidak melihat isi berkas → tidak bisa virus-scan
     synchronously. Butuh S3-compatible storage (AWS S3, MinIO, R2, dll.).

3. **Public bucket + random UUID URL.**
   - **Pros:** Paling murah / paling cepat.
   - **Cons:** URL leak = akses publik permanen. TIDAK ACCEPTABLE untuk data
     medis.

## Decision

Adopsi **Opsi #2 — Presigned PUT + Private Bucket + Presigned GET on Read**.

Arsitektur:

```
[FE] --(1)--> POST /attachments/presign  (contentType, size, purpose)
[BE]   auth check + validate MIME + validate size ≤ 5 MiB
       → generate S3 key: attachments/{purpose}/{companyId}/{userId}/{yyyy}/{mm}/{uuid}.{ext}
       → sign PUT URL (TTL 5 min) with Content-Type + Content-Length bound
       ← { uploadUrl, fileKey, requiredHeaders, expiresIn }
[FE] --(2)--> PUT (direct to S3) with body + signed headers
[FE] --(3)--> POST /leave  { attachmentKey: fileKey, ... }
[BE]   verify fileKey.startsWith(`attachments/{purpose}/{companyId}/{userId}/`)
       → store fileKey in LeaveRequest.attachmentUrl column
[FE] --(4)--> GET /leave/mine
[BE]   for each request with attachment: presign GET (TTL 1 hour)
       → { attachmentUrl: 'https://s3/...?X-Amz-Signature=...' }
[FE]   render <a href={attachmentUrl}>Lihat lampiran</a>
```

### Kunci Keamanan

* **Whitelist MIME**: hanya `image/jpeg`, `image/png`, `image/webp`,
  `application/pdf`. Tidak ada `image/svg+xml` (XSS via inline `<script>`),
  tidak ada tipe eksekusi.
* **Cap 5 MiB** — ditegakkan lewat `Content-Length` yang termasuk dalam
  signature. Klien yang mencoba upload > 5 MiB akan ditolak oleh S3.
* **Prefix ownership check**: kunci S3 selalu berisi `{companyId}/{userId}` di
  path-nya. Saat submit leave, backend verifikasi prefix cocok dengan actor
  → mencegah "steal presign response, submit dengan key user lain".
* **Ekstensi kanonik**: server yang tentukan ekstensi dari MIME, bukan dari
  `file.name` klien → tidak bisa `virus.exe` disamarkan sebagai `.pdf`.
* **Bucket private**: seluruh baca hanya lewat presigned GET (TTL 1 jam,
  cukup untuk HR membuka lampiran saat review).
* **Rate limit presign**: 30 req/menit per user → mencegah presign flooding
  untuk enumerate keys / DoS bandwidth signing.

### Dev environment

Pakai **MinIO** (S3-compatible) di `docker-compose.yml`. Bootstrap otomatis
menciptakan bucket `workpulse` + set anonymous access = `none`. Kredensial
lokal disamakan dengan `.env.example`. Untuk produksi tinggal ubah
`S3_ENDPOINT` + kredensial ke AWS/R2/Wasabi tanpa perubahan kode.

## Consequences

### Positive

* Bandwidth backend flat — dapat scale API tanpa perlu tuning upload buffer.
* Progress bar real-time di FE (XHR).
* Pattern presigned URL reusable → dapat dipakai ulang untuk avatar,
  ekspor besar, dll.
* Isolasi tenant lewat prefix key → S3 lifecycle & audit lebih rapi.

### Negative

* Tidak ada virus scan sinkron. **Mitigasi:** integrasi async ClamAV/S3
  Event → SNS/Lambda scan di future work. Untuk MVP, whitelist MIME +
  cap 5 MiB dianggap acceptable karena berkas hanya diakses oleh pengaju
  sendiri + HR yang trusted.
* Klien harus paham workflow 2-fase (presign → PUT → submit). **Mitigasi:**
  `uploadFileWithPresign` helper di FE menyembunyikan kompleksitas.
* Kolom DB `LeaveRequest.attachmentUrl` sekarang menyimpan **key** bukan URL —
  nama kolom misleading. **Mitigasi:** komentar di kode + rename di migrasi
  future (biaya rendah, tapi bukan MVP blocker).

### Neutral

* Cost S3: dominasi biaya adalah **request count** (PUT + GET), bukan
  storage — tetap murah untuk profil beban kami.

## Rollout / Reversibility

* Merge behind feature flag? **Tidak.** Backend melakukan graceful fallback:
  jika `S3_BUCKET`/`S3_ACCESS_KEY_ID` tidak di-set, `StorageProvider.enabled`
  = false → endpoint `/attachments/presign` mengembalikan 503, dan pembacaan
  leave request dengan attachment mengembalikan `attachmentUrl: null` (tidak
  crash). Legacy leave requests yang tidak butuh lampiran tetap jalan.

* Reversibility: schema DB tidak berubah. Cukup revert kode + hapus MinIO
  service dari compose untuk kembali ke state pre-fase.
