/**
 * ADR-0041 — Location Sharing During Shift consent copy (Bahasa
 * Indonesia).
 *
 * ⚠️ **DO NOT EDIT WITHOUT LEGAL SIGN-OFF.**
 *
 * Any change to `LOCATION_SHARING_CONSENT_COPY_ID` below invalidates
 * every existing user's opt-in and forces re-acceptance on their next
 * visit. Both the tenant-level flip (`SecurityPolicy.locationSharingConsentCopySha`)
 * and the user-level acceptance (`User.locationSharingConsentCopySha`)
 * are pinned to this SHA — Legal reviews the file at a specific SHA
 * and the runtime code refuses drift.
 *
 * # Why the SHA is baked in, not runtime-hashed
 *
 * We could `crypto.subtle.digest` the `text` string at boot, but that
 * loses two guarantees:
 *   1. Content-hash drift is instantly visible in `git diff` because
 *      the constant literally changes. A missed update surfaces as a
 *      failing test (`shaMatchesText.spec.ts`).
 *   2. FE and BE compute the SHA identically without shipping the
 *      hashing implementation twice — the number IS the contract.
 *
 * # Regen procedure (Legal-approved copy change)
 *
 *   1. Legal delivers the new copy in Bahasa Indonesia.
 *   2. Update `text` below.
 *   3. `node -e "console.log(require('crypto').createHash('sha256').update(require('./packages/shared-types/dist/consent-copy/location-sharing.js').LOCATION_SHARING_CONSENT_COPY.text).digest('hex'))"`
 *      (or use the `pnpm --filter @workpulse/shared-types run consent:sha` script).
 *   4. Paste into `id`.
 *   5. `pnpm --filter @workpulse/shared-types test` — the spec fails if
 *      you forgot step 4.
 *   6. Land the PR. Every user is prompted to re-accept on next login.
 */

export interface ConsentCopy {
  /** SHA-256 hex digest of `text`. See regen procedure above. */
  id: string;
  /** Bahasa Indonesia body — plain text, rendered as `<p>` per line. */
  text: string;
  /** ISO 8601 date the current copy was approved by Legal. */
  approvedOn: string;
}

/**
 * Baseline copy shipped with ADR-0041 initial rollout.
 *
 * Draft status: **PENDING legal review**. Rollout gate on
 * `SecurityPolicy.locationSharingEnabled` is closed until Legal
 * signs off on this SHA — see ADR-0041 §Rollout gate for the exact
 * approval procedure.
 */
export const LOCATION_SHARING_CONSENT_COPY: ConsentCopy = {
  id: '18992ef2b1d36c12197c430f9c93559488a0d8d63b120eb872880f3c0f40547e',
  approvedOn: '2026-08-07',
  text: `Persetujuan Berbagi Lokasi Saat Shift Aktif — Workpulse

Fitur ini memungkinkan atasan (supervisor) Anda mengirim satu permintaan lokasi Anda saat shift kerja sedang aktif. Setiap permintaan dan setiap kali lokasi Anda dilihat akan langsung memberi tahu Anda lewat aplikasi dan email.

Apa yang Anda setujui dengan mengaktifkan fitur ini:

1. Kapan lokasi dibagikan.
   Lokasi Anda HANYA dikirim jika Anda menekan tombol "Bagikan" saat menerima permintaan dari supervisor. Aplikasi TIDAK memantau lokasi Anda di latar belakang. Permintaan akan hangus otomatis setelah 15 menit jika tidak Anda jawab, dan supervisor harus mengirim permintaan baru — yang akan kembali memberi tahu Anda.

2. Apa yang dikirim.
   Satu titik koordinat (garis lintang dan garis bujur) beserta perkiraan akurasi GPS dari perangkat Anda pada saat Anda menekan "Bagikan". Tidak ada rekaman terus-menerus, tidak ada riwayat rute, tidak ada informasi lain seperti daftar aplikasi, kontak, atau media.

3. Siapa yang dapat melihat.
   Supervisor Anda yang mengirim permintaan itu, dan HR untuk keperluan audit. Setiap kali salah satu dari mereka membuka koordinat Anda, aplikasi mengirim pemberitahuan ke Anda — jadi Anda selalu tahu.

4. Berapa lama data disimpan.
   Koordinat GPS Anda dihapus otomatis dari sistem setelah 7 hari. Catatan permintaan (siapa meminta, siapa diminta, kapan, hasilnya apa) disimpan 90 hari untuk keperluan audit, tanpa koordinatnya.

5. Hak Anda.
   • Anda berhak menolak permintaan apapun tanpa alasan dan tanpa konsekuensi apa pun terhadap penilaian kerja atau kehadiran Anda.
   • Anda berhak menarik persetujuan ini kapan saja lewat menu "Pengaturan → Privasi". Setelah dicabut, aplikasi menolak permintaan berikutnya secara otomatis.
   • Anda berhak meminta ekspor data lokasi Anda dan menghapus data pribadi Anda sesuai UU 27/2022 tentang Perlindungan Data Pribadi.

6. Dasar hukum & kontak.
   Pemrosesan ini didasarkan pada persetujuan Anda sesuai Pasal 20 UU 27/2022. Pertanyaan atau keluhan dapat diajukan ke Data Protection Officer perusahaan Anda melalui menu bantuan aplikasi.

Dengan menekan "Saya setuju", Anda menyatakan telah membaca dan memahami keterangan di atas.`,
};

/**
 * Small utility used by both server-side controllers and FE forms
 * to detect stale consent. Kept trivial — same string comparison
 * both sides, no branching.
 */
export function consentCopyIsCurrent(pinnedSha: string | null): boolean {
  return pinnedSha === LOCATION_SHARING_CONSENT_COPY.id;
}
