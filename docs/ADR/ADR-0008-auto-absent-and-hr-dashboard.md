# ADR-0008 — Auto-Absent Scheduler & HR Company-Wide Dashboard

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Backend, HR/Payroll, UX
- **Amends:** ADR-0007 (lateness/early-departure detection)
- **Related:** ADR-0005 (overtime completion scheduler — reuses scheduler pattern)

## Context

Sampai fase ini, "user tidak hadir pada hari kerja" adalah _inferensi_
yang dikerjakan oleh setiap konsumer:

- Team-attendance domain menghitung `NOT_CLOCKED_IN` dari `roster ×
attendance` di memory.
- Monthly summary tidak memiliki `absentDays` — user melihat 20 hari
  hadir tanpa tahu berapa hari absen tak-terekam.
- HR tidak punya "dashboard company-wide" — mereka harus buka
  `/attendance/team` (yang di-scope ke supervisor tenant-wide) atau
  export report Excel.

Kelemahan utama pendekatan derivasi-per-query:

1. **Tidak audit-able.** Payroll butuh trail: "kapan HR mengklasifikasi
   user X absen di tanggal Y?" — tanpa row, jawabannya "runtime
   inference".
2. **Duplikasi rules.** Setiap konsumer (report, summary, team-view)
   harus mengulangi definisi "hari kerja & tidak clock-in & tidak
   cuti".
3. **Tidak ada notifikasi.** User baru tahu "kemarin dianggap absen"
   saat akhir bulan report — telat untuk dispute.

Sekaligus, HR meminta dashboard "morning-glance" — headcount vs
clock-in vs absent vs on-leave per departemen, live-refresh.

## Decision

### D1. Materialisasi lewat `AbsenceRecord`, bukan null-clockIn `AttendanceRecord`

Absensi bukan "clock event yang null". Ia adalah **klasifikasi**. Model
terpisah menjaga:

- `AttendanceRecord.clockInAt` tetap NOT NULL — invariant clock event
  utuh (koordinat, akurasi, waktu).
- `AbsenceRecord` punya kolom sendiri (`source`, `reason`, `markedById`)
  yang tidak relevan untuk clock event.
- Zero touch di 16 file yang membaca `AttendanceRecord`.

Alternatif "buat 4 kolom clock-in nullable" ditolak: bocor ke setiap
consumer (report, shift-timing, overtime-completion), semantik jadi
kabur.

### D2. Scheduler hourly, target date resolved per-tenant

Multi-tenant SaaS berbeda timezone. Fixed-daily-cron problematik:
02:00 UTC = 09:00 Asia/Jakarta (kepagian bagi tenant Amerika) atau
21:00 US-East (tenant Australia sudah keburu ganti hari). Solusinya:

- Run `@Cron(EVERY_HOUR)` di top-of-hour.
- Untuk tiap Company: `resolveTargetDate(now, tz, graceHours)` return
  "yesterday-in-tz" bila sudah `graceHours` jam past midnight tenant.
  Bila belum, `null` → skip tenant di tick ini.

Steady-state cost tiap tick ~O(companies) `findFirst` (cursor check).
Real work hanya terjadi di jam yang menyeberang grace window per
timezone — biasanya 1-2 tick per tenant per hari.

### D3. Cursor `Company.lastAbsentScanDate` untuk backfill otomatis

Menyimpan cursor "tanggal terakhir yang sudah aku proses" di kolom
Company. Tiap tick, `pendingScanDates(target, cursor, MAX=30)` mengembalikan
tanggal-tanggal yang belum diproses.

Manfaat:

1. **Recovery gratis.** Cron mati 2 hari? Tick pertama setelah recover
   otomatis backfill 2 tanggal itu. Tanpa cursor kita hanya proses
   "yesterday" dan kehilangan hari-hari di antara.
2. **Cap eksplisit.** `MAX_BACKFILL_DAYS=30` menghindari tenant dormant
   yang membangkitkan `AbsenceRecord` bulanan (irrelevan lagi).
3. **Auditable.** HR melihat `lastAbsentScanDate` untuk verifikasi
   "sistem sudah scan sampai kapan".

### D4. Klasifikasi via decision tree deterministic

`classifyAbsence()` adalah pure function yang menerima 9 boolean/enum
input, memprioritaskan skip-reason paling informatif. Ini disengaja
untuk mempermudah:

- Unit test (semua 8 skip reason + 1 kasus ABSENT masing-masing 1 test).
- Debug operasional: skip-count per-reason di log ("hari ini 40
  NO_SHIFT_ASSIGNMENT, 5 CLOCKED_IN, 2 ON_APPROVED_LEAVE, 3 ABSENT").
- Extension: menambah rule baru = tambah 1 branch, tidak refactor.

### D5. Notifikasi in-app + email best-effort

Setiap klasifikasi ABSENT mengirim `ATTENDANCE_ABSENT_MARKED` ke:

1. **Employee** (nada halus, deep-link ke `/attendance/history` untuk
   dispute).
2. **Direct supervisor** bila ada (deep-link ke team view untuk
   koordinasi).

Notifikasi dikirim SETELAH commit `AbsenceRecord`. Kegagalan notifikasi
tidak rollback klasifikasi — trail audit adalah source of truth,
notifikasi hanya delivery. Ini konsisten dengan pola di leave/overtime.

### D6. Dashboard endpoint: read-only precedence-based aggregator

`GET /attendance/dashboard?date=YYYY-MM-DD` melakukan 4 read parallel
(roster, attendance today, absence today, approved leave today) lalu
mengaggregasi di memory:

```
per-user status = CLOCKED_IN > ABSENT > ON_LEAVE > NOT_CLOCKED_IN
```

Precedence dipilih agar anomali data (user punya `AttendanceRecord`
DAN `AbsenceRecord` di hari yang sama — bug HR entry) tidak menjadikan
angka payroll salah: `CLOCKED_IN` menang, `absent` counter tidak naik.

Per-departemen sort by "exception count" (absent+late) desc → depart
yang paling butuh perhatian di atas.

### D7. RBAC ketat: HR/Super Admin only

Dashboard company-wide TIDAK terbuka untuk supervisor. Supervisor sudah
punya `/attendance/team` (di-scope ke reports langsung). Alasan:

- Data-minimization: supervisor tidak butuh headcount department lain.
- Kompliance: banyak tenant meminta scoping ketat data karyawan.

Manual scanner trigger (`POST /attendance/scanner/run`) di-restrict
lebih jauh ke SUPER_ADMIN karena bisa flip payroll-visible state.

## Consequences

### Positif

- **Auditable payroll.** Baris `AbsenceRecord` dengan `source` dan
  `createdAt` bisa dilink ke pemotongan gaji.
- **Konsisten cross-consumer.** Monthly summary, team view, report,
  dashboard semua konsumsi `AbsenceRecord` — satu source of truth.
- **Timezone-safe scheduler.** Tenant di 5 timezone berbeda sama-sama
  benar tanpa 5 cron entries.
- **Free backfill.** Cursor + pendingScanDates + hourly tick =
  recovery otomatis dari outage tanpa manual sync.

### Trade-offs

- **Extra table.** Payload DB naik 1 row per user per hari kerja
  ABSENT. Untuk tenant 100 orang dengan 5% absensi rata-rata, ~1000
  row/bulan — negligible.
- **Enum `AttendanceStatus.ABSENT` sekarang unused.** Legacy dari
  desain awal; akan di-deprecate di ADR mendatang bila kita drop enum
  value.
- **Notifikasi bisa spam.** Bila tenant lupa isi shift assignment
  untuk banyak user, klasifikasi ABSENT tidak terjadi (skip
  `NO_SHIFT_ASSIGNMENT`) — safe. Tapi bila user memang absen sungguhan,
  supervisor kena 1 notifikasi per report per hari. Mitigasi: bell UI
  sudah support "mark all read", dan tenant besar sebaiknya
  route email ke dedicated address, bukan HR pribadi.

## Alternatives Considered

### A1. Null-nullable `clockInAt` (rejected)

Membuat kolom clock-in nullable dan menggunakan `AttendanceStatus.ABSENT`.
Ditolak: menyentuh 16 file consumer, dan menggabungkan "klasifikasi"
dengan "clock event" secara semantik lemah.

### A2. Derive-per-query (rejected)

Hitung absent di setiap read query lewat roster×attendance join.
Ditolak: aturan absensi (shift assignment, holiday, leave, hire date)
kompleks — duplikasi di 4+ konsumer akan drift. Juga tidak menyediakan
trail audit yang HR minta.

### A3. External Kubernetes CronJob (parked)

Meng-invoke `POST /attendance/scanner/run` dari K8s CronJob eksternal
tiap 5 menit, alih-alih in-process `@Cron`. Parked untuk future: butuh
saat kita horizontal-scale API pods dan overlap protection in-process
tidak cukup. Untuk MVP single-pod, in-process cron cukup + guard
boolean.

### A4. Daily-only, single UTC time (rejected)

Simpler, tapi timezone problem (D2). Kalau tenant expand ke US barat
dengan grace 6h, target date 08:00 UTC = 00:00 PST yang terlalu awal.

## Migration & Deployment

- Migration `20260802040000_add_absence_records`:
  - Buat `AbsenceRecord` table + `AbsenceSource` enum.
  - Tambah `Company.absentScanGraceHours` (default 6) +
    `Company.lastAbsentScanDate` (nullable).
  - Tambah enum value `ATTENDANCE_ABSENT_MARKED` ke `NotificationType`.
- **Backfill risk:** Setelah deploy, first tick per tenant akan proses
  hingga 30 hari ke belakang (dari null cursor). Ini SENGAJA agar
  historikal absensi tercermin di report. Bila HR tidak menginginkan:
  set `Company.lastAbsentScanDate = yesterday` via SQL sebelum deploy.
- **Rollback:** DROP TABLE `AbsenceRecord`, ALTER Company (remove 2
  kolom), enum value tidak dapat di-drop di Postgres — ok, biarkan
  saja (tidak akan diemit lagi).

## Follow-ups

1. Manual override endpoint `POST /attendance/absence` untuk HR
   (source=MANUAL_HR).
2. UI HR untuk melihat `Company.lastAbsentScanDate` + tombol "run
   scanner sekarang" (SUPER_ADMIN).
3. Deprecate `AttendanceStatus.ABSENT` (unused sekarang).
4. `Shift.workingDays[]` untuk shift yang tidak Mon–Fri (contoh:
   shift retail Sabtu-only).
5. Weekly HR digest email: agregasi `AbsenceRecord` seminggu, deep-link
   ke dashboard.
