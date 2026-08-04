# ADR-0007 — Server-Side Lateness & Early-Departure Detection

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Backend, HR/Payroll, UX
- **Amends:** ADR-0001 (stack) — no schema conflicts

## Context

Sejak awal, `AttendanceRecord` menyimpan `lateMinutes`, `earlyLeaveMinutes`,
dan `status` (`ON_TIME | LATE | EARLY_LEAVE | ABSENT | ON_LEAVE`), dan
`attendance/domain/shift-timing.ts` menghitung nilai-nilai ini di server.
Tapi feature ini "silent" — angka disimpan tanpa ada UI yang menampilkannya
kepada user. Laporan HR (attendance report Excel/PDF) menampilkannya, tapi
karyawan yang bersangkutan tidak bisa self-service melihat rekap disiplinnya.

Beberapa question yang harus dijawab oleh ADR ini:

1. Di mana perhitungan late/early boleh terjadi? (server vs client)
2. Bagaimana grace period didefinisikan? (per-shift vs per-company)
3. Apakah `lateMinutes` dan `earlyLeaveMinutes` bisa berdampingan di satu row?
4. Bagaimana laporan self-service dibedakan dari report HR?

## Decision

### D1. Perhitungan hanya di server

Client (mobile browser / native) **tidak pernah** menghitung lateness. Dua
alasan:

- **Device time is spoofable.** Setting jam manual, VPN ke timezone lain,
  atau bahkan modifikasi cukup mudah untuk teknisi yang termotivasi.
- **Grace period + timezone perusahaan** adalah policy — policy harus
  berada di trust boundary, bukan di UI.

Client cukup mengirim koordinat + timestamp _dari server response_. Server
memakai `Date.now()` (wall clock) sebagai satu-satunya sumber kebenaran.

### D2. Grace period per-shift, bukan per-company

`Shift.graceMinutes` sudah ada di schema. Alternatif: `Company.attendanceGraceMinutes`.

Dipilih **per-shift** karena:

- Perusahaan real punya kebijakan berbeda per role (mis. tim customer support
  grace 5 menit karena harus buka toko tepat waktu; tim engineering grace 15
  menit karena flexible-hour policy).
- Migrasi ke per-shift dari per-company mudah; kebalikannya sulit.
- Jika perusahaan hanya punya 1 shift, secara efektif ini sama dengan
  per-company.

### D3. Grace HANYA untuk clock-in

Late detection menerima grace: `clockIn > shiftStart + grace` → LATE.

Early detection **tidak** menerima grace: `clockOut < shiftEnd` → EARLY_LEAVE.

Alasan: grace di keduanya efektifnya menciptakan "shift terkontrak lebih
pendek", yang tidak konsisten dengan payroll assumption. HR ingin tahu
persis kapan karyawan meninggalkan tempat kerja — 1 menit lebih awal sudah
early. Kombinasi ini juga menghindari edge case "employee terlambat 10 menit
tapi juga pulang 10 menit lebih awal → status ON_TIME karena keduanya di
dalam grace" yang absurd.

### D4. `lateMinutes` dan `earlyLeaveMinutes` bisa co-exist

Satu row bisa memiliki `lateMinutes > 0` **DAN** `earlyLeaveMinutes > 0`
(mis. karyawan yang terlambat 10 menit dan pulang cepat 20 menit).

Konsekuensi untuk `status` enum: karena `status` cuma satu value, kita pilih
**early state wins on clock-out**. Alur:

1. Clock-in `LATE` → row disimpan dengan `status = LATE`.
2. Clock-out early → row di-update `status = EARLY_LEAVE`.

Ini memberi observabilitas: `status = EARLY_LEAVE` di HR report menandakan
"pasti pulang cepat", meski karyawan juga terlambat.

Untuk aggregation (rekap bulanan), kita **tidak** bergantung pada `status`
karena bisa hilang informasi. Reducer `summarizeAttendance` mengevaluasi
`lateMinutes` dan `earlyLeaveMinutes` secara terpisah — satu row bisa
menambah counter di kedua ember.

### D5. Self-service vs HR report

| Aspek      | Self-service (`/me/summary`, `/me/history`)  | HR Report (`/reports/attendance`)           |
| ---------- | -------------------------------------------- | ------------------------------------------- |
| Scope      | Caller only                                  | Tenant-wide, filter dept/user               |
| Time range | 1 bulan (summary) / 90-366 hari (history)    | Arbitrary (bounded 366 hari)                |
| Output     | JSON, dashboard widget                       | Streaming Excel + PDF                       |
| Reducer    | `summarizeAttendance` (jam total, on-time %) | `toAttendanceReportRows` (row-level detail) |
| Auth       | Semua role                                   | `HR_MANAGER` / `SUPER_ADMIN`                |

Keduanya memakai kolom yang sama (`lateMinutes`, `earlyLeaveMinutes`,
`status`) — perbedaan hanya di shape output. Tidak ada aggregate table
tersembunyi; single source of truth adalah `AttendanceRecord` mentah.

## Positive Consequences

- **Trust boundary bersih.** Semua perhitungan disiplin sudah di server;
  client hanya menampilkan.
- **Reusability.** `summarizeAttendance` dipakai oleh dashboard widget
  sekarang, siap dipakai lagi untuk supervisor team view dan admin
  overview nanti tanpa duplikasi logic.
- **Auditability.** HR bisa cross-check angka di widget dengan angka di
  report — sama-sama dari `AttendanceRecord` mentah.
- **Backward compatible.** Semua fields sudah ada di schema, tidak perlu
  migration untuk fase ini.

## Negative Consequences

- **Timezone gymnastics.** `shiftBoundaryToUtc` memakai `Intl.DateTimeFormat`
  yang lebih lambat dari arithmetic biasa. Untuk shift eval per clock-in
  ini tidak masalah, tapi jika kita perlu batch backfill 100k rows di masa
  depan, perlu caching offset per (workDate, timezone).
- **`status` masih single-valued.** Row yang late + early jam pertama
  disimpan sebagai `LATE`, lalu di-update ke `EARLY_LEAVE`. Kalau kita
  butuh "kedua badge sekaligus" di future UI, kita harus membaca dari
  `lateMinutes`/`earlyLeaveMinutes` dan bukan `status`. Widget sudah
  melakukan ini.
- **Grace hanya per-shift.** Perusahaan yang ingin policy per-department
  atau per-user harus membuat shift terpisah — bisa membebani
  `UserShiftAssignment`. Diterima untuk MVP.
- **Tidak ada absence detection.** `ABSENT` status tidak pernah otomatis
  di-set — hanya diproduksi bila HR / cron menandai row secara eksplisit.
  Feature "auto-absent after grace × N" adalah follow-up fase (butuh cron
  yang lebih kompleks).

## Alternatives Considered

### A. Compute at read time (no persisted lateness)

Simpan hanya `clockInAt` + `clockOutAt`, hitung lateness on-demand di report
generation. Kelebihan: schema lebih ringkas. Kekurangan: setiap query
`SELECT count(*) WHERE lateMinutes > 0` menjadi mahal (harus join Shift +
timezone lookup). **Ditolak** — column ini dibaca >>> ditulis.

### B. Client-side computation dengan server verifikasi

Client kirim `lateMinutes` dihitung sendiri, server hanya validate. Menghemat
CPU server tapi trust boundary jadi rapuh — kita harus tetap hitung ulang
di server anyway. **Ditolak**, no real benefit.

### C. Grace period at both endpoints

Grace juga untuk `earlyLeaveMinutes` — mis. pulang <5 menit sebelum shift
end masih ON_TIME. **Ditolak**, lihat D3.

### D. Multi-status field (`status: LATE[] | EARLY_LEAVE[]`)

Simpan array status alih-alih enum tunggal. Kelebihan: satu row bisa punya
banyak "flag". Kekurangan: query "berapa hari saya terlambat" jadi lebih
kompleks (perlu `ANY(status)` predicate), dan API/DTO menjadi awkward.
**Ditolak** — pakai `lateMinutes`/`earlyLeaveMinutes` scalars sebagai
source of truth, `status` hanya untuk display convenience.

## Implementation

- **Backend**
  - `apps/api/src/attendance/domain/shift-timing.ts` — pure late/early
    calculators (sudah ada).
  - `apps/api/src/attendance/domain/attendance-summary.ts` — pure
    monthly aggregator (baru).
  - `apps/api/src/attendance/attendance.service.ts` — `listMyHistory`,
    `getMyMonthlySummary` (baru).
  - `apps/api/src/attendance/attendance.controller.ts` — `GET /me/history`,
    `GET /me/summary` (baru).
- **Frontend**
  - `apps/web/components/features/attendance/clock-panel.tsx` — inline
    timing badges (extended).
  - `apps/web/components/features/attendance/monthly-summary-widget.tsx`
    — dashboard card (baru).
  - `apps/web/components/features/attendance/attendance-history.tsx` —
    tabel history (baru).
  - `apps/web/app/(dashboard)/attendance/page.tsx` — root page dengan
    widget + link.
  - `apps/web/app/(dashboard)/attendance/history/page.tsx` — halaman
    history (baru).
- **Shared types**
  - `packages/shared-types/src/attendance.ts` — `AttendanceHistoryQuery`,
    `AttendanceMonthlySummary` schemas (baru).
- **Docs**
  - `docs/WORKFLOW.md §1.3 – §1.4` — rule + endpoint catalog (extended).

## References

- ADR-0001 (stack)
- Workflow §1 (Attendance)
- Shift model: `apps/api/prisma/schema.prisma` (kolom `startTime`, `endTime`,
  `graceMinutes`)
