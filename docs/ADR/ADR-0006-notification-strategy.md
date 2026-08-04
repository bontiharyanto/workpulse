# ADR-0006 — Notification Strategy (In-App + Email)

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Backend, Frontend, HR/UX

## Context

Sampai fase ini, Workpulse tidak memiliki mekanisme "push" apapun: setelah
seorang employee submit cuti, ia harus refresh halaman berulang untuk tahu
apakah supervisor sudah memutuskan; supervisor tidak tahu ada antrean baru
kecuali mereka memuat `/leave/approvals`. Untuk aplikasi kehadiran
enterprise ini adalah gap UX yang serius — kritik user testing paling
sering muncul dari sini.

Kebutuhan minimum yang ingin kita selesaikan:

1. **Persistence** — user offline saat event terjadi masih harus melihatnya
   di kunjungan berikutnya.
2. **Multi-channel** — in-app di dashboard + email untuk user yang jarang
   log in.
3. **Multi-tenant** — notifikasi tidak boleh bocor antar-perusahaan.
4. **Extensible** — event baru (mis. `LEAVE_CANCELLED`) harus dapat
   ditambahkan tanpa mengubah service konsumer.

## Alternatives Considered

### A. Real-time WebSocket / SSE

Kualitas UX terbaik (badge update instan), tapi:

- Butuh sticky-session load balancer atau state di Redis.
- Butuh authentication ulang untuk long-lived connection.
- Untuk skala MVP (~ratusan user aktif per tenant) polling 30 detik sudah
  cukup dan biayanya rendah.

**Ditolak untuk MVP**; disisakan sebagai upgrade path — `useUnreadCount`
di bell adalah abstraction seam yang bisa diganti oleh `useSseChannel`.

### B. Third-party service (Novu / Knock)

Mem-outsource seluruh persistence + fanout + preference management.
Kelebihan: fitur langsung matang (digest, quiet hours, preferences UI).
Kekurangan: dependensi vendor, data flow keluar tenant, biaya per-message.

**Ditolak** karena Workpulse harus tetap portable (on-prem friendly untuk
customer enterprise). Persistence sederhana di DB kita sendiri lebih aligned
dengan positioning produk.

### C. Log-only (tanpa persistence)

Cukup print ke stdout dan biarkan operator hook ke log stream. Cepat, tapi:

- User tidak bisa lihat history via UI.
- Email tetap butuh implementasi terpisah.

**Ditolak** — pada dasarnya sama dengan tidak punya notifikasi bagi user.

### D. Pilihan Terpilih: Persisted rows + template pure + pluggable email

- Tabel `Notification` per recipient dengan `readAt` sebagai flag "seen".
- Template pure (`domain/templates.ts`) yang menerima typed input dan
  mengembalikan `{ title, body, data }`. Bisa di-unit-test tanpa DB / clock.
- `EmailAdapter` interface + `ConsoleEmailAdapter` (default). Slot untuk
  `SmtpEmailAdapter` kelak.
- Insert notifikasi masuk ke transaction yang sama dengan operasi bisnis
  (submit / decide), sehingga rollback bisnis membatalkan notifikasi juga.
- Email dispatch fire-and-forget setelah insert — kegagalan SMTP tidak boleh
  membatalkan tx bisnis.

## Positive Consequences

- **Simple mental model.** Trigger point → `notifications.createOne(...)`
  → row + optional email. Tidak ada queue, tidak ada worker.
- **Testable.** Template pure di-cover unit tests; service tests dapat
  mock `EmailAdapter` dengan struct fake tanpa harness khusus.
- **Multi-tenant safe.** Filter di controller adalah `recipientId = actor.id`
  — mustahil melihat notifikasi tenant lain karena user tidak bisa berpindah
  tenant, dan FK ke `User` menegakkan integritas.
- **Upgrade-safe.** Menambah event baru = tambah `NotificationType` enum +
  template + panggilan `notifications.createOne`. Tidak ada migrasi kolom
  yang perlu diubah.

## Negative Consequences

- **Polling cost.** 30-second interval berarti ~120 request per user per
  jam untuk `unread-count`. Endpoint didesain sangat murah (satu index
  scan pada `(recipientId, readAt, createdAt)`) tapi tetap bukan zero.
  Dengan 500 user aktif per tenant → ~60k req/jam per tenant, masih baik
  untuk single API instance.
- **Rollback semantics tidak sempurna untuk email.** Email dijadwalkan
  segera setelah insert (microtask). Bila tx utama gagal rollback setelah
  microtask sudah run, email sudah terkirim tapi row tidak ada. Ini rare
  event dan trade-off yang sengaja diambil — alternatifnya adalah queue
  yang di-drain via tx hook (complex).
- **Retention manual.** Tidak ada TTL bawaan. Untuk tenant sangat aktif,
  cron cleanup perlu ditambah nanti.
- **SMTP belum di-ship.** MVP tidak install nodemailer sebagai runtime
  dep — bila `EMAIL_TRANSPORT=smtp` dipasang di production, adapter akan
  soft-fallback ke console dan mencatat warning. Ini disengaja: kita ingin
  operator eksplisit meng-add nodemailer + review SMTP config sebelum
  mengaktifkannya.

## Audit Trail

Row `Notification` **bukan** pengganti `AuditLog`. Perbedaan:

| Aspek       | `Notification`                            | `AuditLog`                            |
|-------------|-------------------------------------------|---------------------------------------|
| Audience    | End user                                  | HR / compliance                       |
| Retention   | Sampai HR menghapus manual                | Immutable (revoke UPDATE/DELETE)      |
| Detail      | Text summary + deep link                  | Before/after JSON, actor, action code |
| Multi-tenant| Ya, via `companyId` + `recipientId`       | Ya, via `companyId` + `actorId`       |
| Query pattern | Per user, last N unread                 | Per entity/entityId, forensik         |

Kedua tabel diisi di trigger point yang sama tapi tidak saling mengganti.

## References

- Implementation:
  - `apps/api/src/notification/*`
  - `apps/api/prisma/migrations/20260801200000_add_notifications/*`
- Integration points:
  - `LeaveService.submit`, `LeaveService.decide`
  - `OvertimeService.submit`, `OvertimeService.decide`
  - `OvertimeCompletionService.runCompletion`
- Frontend:
  - `apps/web/components/features/notifications/notification-bell.tsx`
- Workflow: `docs/WORKFLOW.md §9`
