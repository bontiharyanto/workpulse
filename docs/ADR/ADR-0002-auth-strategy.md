# ADR-0002 — Authentication Strategy: Access JWT + Refresh Rotation with Reuse Detection

- **Status:** Accepted (amended 2026-08-02 to add Password Recovery)
- **Date:** 2026-08-01
- **Deciders:** Founding engineering team
- **Supersedes:** none

## Context

Workpulse adalah aplikasi enterprise dengan konsekuensi bisnis nyata (payroll, kehadiran, cuti). Kami butuh model auth yang:

1. Aman terhadap XSS (mencegah pencurian token melalui script injection).
2. Aman terhadap CSRF pada endpoint sensitif.
3. Mendukung session yang panjang tanpa mengorbankan revokabilitas.
4. Mendeteksi token yang dicuri.
5. Mudah diintegrasikan dengan Next.js App Router (RSC + Client Components) dan mobile client di masa depan.

## Decision

Kami memakai **JWT access token pendek (15m) + opaque refresh token panjang (7d)** dengan:

- Access token **in-memory** di frontend (React context), dikirim via `Authorization: Bearer`.
- Refresh token opaque (48-byte base64url random), dikirim ke client hanya via **`HttpOnly Secure SameSite=Lax` cookie**, hash-nya (SHA-256) yang disimpan di database.
- **Rotasi wajib** setiap kali refresh dipakai. Token yang dipakai ulang setelah rotasi memicu **"reuse detected"** → seluruh family di-revoke.
- Password hash: **argon2id** dengan parameter OWASP 2026 (m=19MiB, t=2, p=1); auto-rehash saat login bila parameter tersimpan sudah usang.
- Login endpoint di-throttle: **5 percobaan / 60 detik** per IP (via `@nestjs/throttler`).
- Response konstan-waktu untuk login gagal (baik email tidak ada maupun password salah) — argon2 tetap dieksekusi terhadap hash palsu untuk mencegah account enumeration via response time.

## Rationale

### Why not access token in localStorage?
XSS attack surface luas (npm dependency, ekstensi browser). Token di `localStorage` mudah diambil `document.cookie` bypass tidak berlaku. In-memory access token + HttpOnly refresh cookie = worst case, XSS hanya bisa melakukan aksi selama halaman tersebut hidup, tidak bisa mengekspor token.

### Why opaque refresh, bukan JWT refresh?
- Revokabilitas: menghapus row di DB langsung invalidate. JWT refresh butuh blacklist atau versioning.
- Reuse detection: opaque + row per token memungkinkan tracking `familyId` untuk deteksi replay attack.
- Ukuran cookie lebih kecil.

### Why familyId + reuse detection?
Skenario: attacker mencuri refresh cookie, memakainya untuk mendapat access + refresh baru. Legitimate user kemudian me-refresh dengan cookie lama → token lama sudah `ROTATED` → sistem menganggap ada reuse → **revoke seluruh family** (token attacker termasuk). User legitimate ter-logout dan aware bahwa ada anomali. Ini pola standar dari OAuth 2.1 draft.

### Why SameSite=Lax bukan Strict?
`Lax` mengizinkan navigasi top-level (misal user klik link email masuk aplikasi) sambil tetap memblokir CSRF pada mutating requests. `Strict` terlalu ketat untuk UX SSO/deep-link.

### Why not include CSRF token?
Endpoint yang butuh state-changing sudah pakai `Authorization: Bearer <access-token>`, yang tidak dikirim otomatis oleh browser. Refresh endpoint `/auth/refresh` menerima cookie tapi hanya untuk **memperbaharui token**, tidak berdampak bisnis. Ini kombinasi standar Bearer-header + HttpOnly cookie yang menghilangkan kebutuhan CSRF token untuk sebagian besar endpoint. Endpoint yang menggunakan cookie sebagai satu-satunya credential (kalau kelak ada) akan mendapat CSRF token guard.

## Alternatives Considered

1. **Session cookie (sticky server-side session).**
   - Pro: Simple, revokable trivially.
   - Kontra: Butuh sticky session di load balancer atau shared session store; buruk untuk mobile client; JWT lebih portable.

2. **BFF (Backend-for-Frontend) full-cookie flow.**
   - Pro: Frontend zero-knowledge tentang token.
   - Kontra: Butuh proxy layer terpisah di Next.js; overkill untuk fase awal. Bisa dipertimbangkan ADR-0005 ketika mobile client diadopsi.

3. **Bearer refresh (JWT).**
   - Pro: Stateless.
   - Kontra: Revoke butuh blacklist store; ukuran cookie lebih besar; reuse detection lebih rumit.

## Consequences

**Positif:**
- Model auth production-grade di fase 1.
- Deteksi replay attack sudah built-in.
- Access token exposure surface minimal.
- Kompatibel dengan mobile client (SecureStore untuk refresh).

**Negatif / Trade-off:**
- Reload page = satu roundtrip ekstra ke `/auth/refresh`. Diterima untuk security gain.
- MVP: route protection sisi client (`RequireAuth` component). Middleware Next.js belum bisa membaca HttpOnly cookie tanpa validasi ke API — akan direalisasi di fase 2 (server-side gate memvalidasi ke `/auth/me`).

## Password Recovery (added 2026-08-02)

Alur "lupa password" mengikuti bentuk yang sama dengan refresh: **opaque
random secret dikirim ke user, SHA-256 hash disimpan di DB.** Detail
implementasi lengkap ada di [`docs/WORKFLOW.md §0.6`](../WORKFLOW.md). Poin-poin
desain yang penting:

- **Single-channel delivery via email.** Reset link tidak pernah muncul di
  in-app UI karena user yang lupa password memang tidak bisa login untuk
  melihatnya. Konsekuensi: link hanya se-aman inbox email user (mendorong
  penerapan MFA / mail security di sisi enterprise IT, di luar scope MVP).
- **No user enumeration.** `POST /auth/forgot-password` selalu 202 dengan
  body identik untuk email terdaftar maupun tidak — mengikuti pola sama
  yang sudah dipakai `POST /auth/login` (`UNAUTHORIZED` generik). Server
  bahkan tetap melakukan sedikit hashing pada branch "email tak dikenal"
  untuk mitigasi timing oracle.
- **Global session kill on success.** Setiap ACTIVE refresh token milik
  user di-`REVOKE` dalam transaksi yang sama dengan update password. Ini
  mengevakuasi setiap sesi yang dibuat sebelum reset — termasuk sesi
  attacker seandainya reset dilakukan attacker, dan termasuk sesi legit
  user lain di device lain (small usability cost untuk security gain
  yang besar).
- **Single-use + expiring tokens.** TTL 30 menit; `usedAt` di-set atomik
  via `updateMany({ usedAt: null } → { usedAt: now })` untuk menutup race
  antara dua request paralel. Reset sukses juga meng-invalidate token
  lain yang belum kepakai (defense-in-depth terhadap serangan "attacker
  minta 2 link").
- **Error uniformity.** Semua kegagalan (token tidak ada / expired / used
  / malformed / user disabled) di-map ke `INVALID_TOKEN` — attacker tidak
  bisa membedakan "token pernah ada tapi sudah kadaluarsa" dari "token
  tidak pernah eksis".
- **Confirmation notification.** Setelah reset sukses, `Notification`
  tipe `PASSWORD_RESET` dibuat (in-app + email fanout via
  `NotificationService`) berisi IP + user-agent hint untuk forensik.
  Notifikasi ini **tidak** memuat link (link sudah consumed).
- **Rate limits.** Forgot 5/menit per IP, Reset 10/menit per IP (via
  `@nestjs/throttler`). Batas per-email tidak diberlakukan karena akan
  memberi channel enumeration ("email ini sudah dikirimi 3 kali =
  terdaftar"); throttling per-IP sudah cukup melindungi email server dari
  abuse volume.

## Follow-ups

1. **Server-side route protection.** Membuat middleware Next.js yang forward cookie ke `/auth/me` sebelum render RSC halaman `(dashboard)`. Butuh caching agar tidak N+1.
2. **MFA (TOTP).** Belum ada; akan dituangkan ke ADR terpisah setelah observasi behavior password recovery live.
3. **OAuth SSO** (Google Workspace / Microsoft Entra) untuk enterprise — ADR terpisah kelak.
4. **Rate-limit tuning** berdasar telemetry setelah live traffic.
5. **Reset token TTL cleanup cron.** Tabel `PasswordResetToken` akan
   berkembang seiring waktu. Index pada `expiresAt` sudah disiapkan untuk
   sweeper cron yang akan dibuat saat volumenya jadi material.
