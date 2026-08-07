# Architecture — Workpulse

## 1. Guiding Principles

- **Clean Architecture + DDD.** Domain layer bebas framework, dependency selalu ke arah domain, bukan sebaliknya.
- **Multi-tenant sejak awal.** Setiap tabel domain punya `companyId`; tidak ada global cross-tenant query di luar layer super-admin.
- **Server-side truth.** Setiap keputusan bisnis (geofence, saldo cuti, pemotongan quota, otorisasi) dihitung di backend. Frontend hanya menyajikan.
- **Immutability + audit.** Perubahan sensitif meninggalkan jejak di `AuditLog` yang tidak bisa di-UPDATE/DELETE di level DB role.

## 2. High-Level Diagram

```
┌────────────────────┐        HTTPS         ┌────────────────────────────┐
│  Next.js (App Router) ├────────────────────►│  NestJS API (REST)          │
│  RSC + TanStack Query │◄────────────────────┤  Guards → Filters → Services │
└─────────┬──────────┘                       └────────────┬────────────────┘
          │                                               │
          │                                               ▼
          │                                       ┌───────────────┐
          │                                       │  Prisma       │
          │                                       │  Client (+ext)│
          │                                       └──────┬────────┘
          │                                              ▼
          │                                       ┌───────────────┐
          │                                       │  PostgreSQL   │
          │                                       └───────────────┘
          ▼
    Browser Geolocation
    (raw coords sent as-is; no client-side geofence trust)
```

## 3. Backend Layering (`apps/api/src/<feature>/`)

```
attendance/
├── attendance.module.ts        # Nest wiring
├── attendance.controller.ts    # HTTP interface (thin)
├── attendance.service.ts       # Application: orchestration + tx
├── dto/                        # class-validator input/output
└── domain/                     # Pure functions & value objects
    ├── coordinates.ts
    ├── geofence.ts
    └── shift-timing.ts
```

Rules:

- **Controllers** tidak boleh mengimpor `PrismaService`.
- **Services** hanya mengimpor `PrismaService`, service lain, dan file dari `domain/`.
- **Domain** hanya mengimpor `domain/*` — tanpa `@nestjs/*`, tanpa Prisma. Membuatnya sepele di-unit-test.

### 3.1 Location Sharing Module Boundary (ADR-0041)

Modul `src/location-sharing/` mengikuti bentuk yang sama, dengan tiga
titik interaksi:

- Depends **on** `PrismaService`, `NotificationService`, dan
  `SecurityPolicyService` (untuk membaca feature flag tenant).
- Depends **on** shared consent copy dari `@workpulse/shared-types`
  (`LOCATION_SHARING_CONSENT_COPY`) — SHA-256-nya adalah kontrak
  dengan Legal.
- Depended **on by** — belum ada. Modul lain tidak boleh mengimpor
  `LocationSharingService` sebagai ketergantungan konsumen (mis. HR
  reporting), karena data lokasi punya retention terpisah 7 hari dan
  tidak boleh bocor ke laporan retensi lebih panjang.

Domain layer (`domain/request-lifecycle.ts`) memegang konstanta TTL,
quota, dan retensi + pure state-transition guards; service memegang
orkestrasi transaksi + audit + notifikasi fanout. Retention worker
(`location-sharing-retention.worker.ts`) hanya menggerakkan cron —
purge logic-nya berada di `purgeLocationSharingForCompany` yang bisa
di-unit-test tanpa Nest scheduler.

### 3.2 Maps Module Boundary (ADR-0042)

Modul `src/maps/` adalah tenant-neutral read-through cache. Ia hanya
bergantung pada `ConfigService` + kredensial S3 yang sudah diteruskan
untuk `attachments`. Zero akses DB, zero akses `PrismaService`.

- Depends **on** — hanya env (`MAPS_ENABLED`, `MAPS_TILES_BUCKET`,
  `MAPS_PMTILES_KEY`, dan varian geocode). Membaca objek `pmtiles`
  dan glyph/sprite lewat AWS SDK v3.
- Depended **on by** — belum ada modul lain. FE memakainya langsung
  via HTTP (`/api/v1/maps/*`) — jangan pernah mengimpor
  `MapsService` dari service domain lain, karena request tile
  tidak boleh ikut ke dalam transaksi domain.

Domain helper (`domain/tile-coord.ts`) menangani parsing `z/x/y`,
fontstack, glyph range, dan sprite asset — semua pure functions
yang dites terpisah dari service. `S3PMTilesSource` adalah adapter
tipis: PMTiles library membutuhkan `Source.getBytes(offset, length)`
dan kita hanya menerjemahkan itu ke `GetObjectCommand` dengan header
`Range`. Directory pages di-cache di dalam library PMTiles (bounded),
jadi warm request rata-rata satu S3 hit per tile.

Boot posture: `MAPS_ENABLED=false` (default) → semua endpoint 503
`MAPS_DISABLED`. Ops flip ke `true` setelah menjalankan
`docs/OPS/MAP-BOOTSTRAP.md` untuk mengisi bucket `workpulse-maptiles`.

## 4. Cross-Cutting Concerns

| Concern                | Location                                                                   |
| ---------------------- | -------------------------------------------------------------------------- |
| Global validation pipe | `src/main.ts` (`ValidationPipe`)                                           |
| Error mapping          | `src/common/filters/http-exception.filter.ts` + `all-exceptions.filter.ts` |
| Request logging        | `src/common/interceptors/logging.interceptor.ts`                           |
| Auth (JWT)             | `src/auth/` — `JwtStrategy`, `JwtAuthGuard`                                |
| RBAC                   | `src/common/decorators/roles.decorator.ts` + `guards/roles.guard.ts`       |
| Prisma singleton       | `src/prisma/prisma.service.ts`                                             |
| Config validation      | `src/config/env.validation.ts` (Zod)                                       |

## 5. Data Model Highlights (see `apps/api/prisma/schema.prisma`)

- **Company / Department / User** — tenant tree; `User.role` drives RBAC.
- **Shift, Geofence, UserShiftAssignment** — many-to-many shifts, effective dating for rotating shifts.
- **AttendanceRecord + AttendanceEvent** — record adalah aggregate harian, event adalah append-only trail.
- **LeaveType / LeaveBalance / LeaveRequest** — `LeaveBalance` punya kolom `version` untuk optimistic locking bersamaan dengan `SELECT ... FOR UPDATE`.
- **OvertimeRequest** — pre-approval flow dengan `ratePerHour` & `totalAmount` yang dikomputasi server-side.
- **Holiday** — kalender per company; digunakan saat menghitung durasi cuti.
- **SecurityPolicy** — tenant-scoped feature-flag row (MFA enforcement, location-sharing enable). Cached 30s per tenant di `SecurityPolicyService`. Perubahan menghasilkan `SECURITY_POLICY_UPDATED` audit dengan before/after diff.
- **LocationShareRequest + LocationPing** (ADR-0041) — on-demand supervisor-initiated location share. Request row 90d retention (audit metadata), Ping row 7d retention (coord). Partial unique index memastikan max satu `PENDING` per (supervisor, target).
- **AuditLog** — immutable; `REVOKE UPDATE, DELETE` untuk role app.

Semua tabel domain: `createdAt`, `updatedAt`, `deletedAt` (soft delete kecuali `AttendanceEvent`, `AuditLog`, `Holiday`).

## 6. Concurrency & Transactions

### Prinsip

> Setiap operasi bisnis yang menyentuh > 1 baris atau memutakhirkan invariant harus berjalan di dalam **satu transaksi**.

### Pola untuk saldo cuti (mencegah double-spend)

```ts
await prisma.$transaction(
  async (tx) => {
    const [balance] = await tx.$queryRaw<LeaveBalance[]>`
    SELECT * FROM "LeaveBalance"
    WHERE "userId" = ${userId} AND "leaveTypeId" = ${leaveTypeId} AND "year" = ${year}
    FOR UPDATE
  `;
    if (!balance || balance.remaining < requestedDays) {
      throw new BadRequestException('INSUFFICIENT_BALANCE');
    }
    await tx.leaveBalance.update({
      where: { id: balance.id },
      data: {
        remaining: { decrement: requestedDays },
        used: { increment: requestedDays },
        version: { increment: 1 },
      },
    });
    await tx.leaveRequest.create({/* ... */});
    await tx.auditLog.create({/* ... */});
  },
  { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
);
```

## 7. Timezone Handling

- Semua timestamp disimpan **UTC** (`DateTime` di Prisma).
- Setiap `Company` punya `timezone` IANA (default `Asia/Jakarta`). `User.timezone` dapat override.
- Konversi ke timezone lokal terjadi **hanya di presentation layer** (Next.js), atau di kalkulasi shift lokal saat evaluasi lateness (`domain/shift-timing.ts`).
- `AttendanceRecord.workDate` disimpan sebagai UTC-midnight (`@db.Date`) — mewakili tanggal kerja setelah normalisasi.

## 8. Frontend Structure (`apps/web/`)

- `app/(dashboard)/*` — halaman utama, default **Server Component**.
- `components/features/<domain>/` — Client Components interaktif (`clock-panel.tsx`).
- `lib/api-client.ts` — typed fetch wrapper, memakai types dari `@workpulse/shared-types`.
- `components/providers/` — provider TanStack Query, theme, dsb.

## 9. Deployment Assumptions (belum diimplementasi)

- API + web sebagai container (Docker) di belakang reverse proxy.
- Postgres managed (Neon/RDS/CloudSQL).
- File upload → S3 (attachment cuti/izin). Untuk lokal: `storage/uploads/`.
- Migrasi Prisma di pipeline CI: `pnpm db:migrate:deploy` sebelum `pnpm start`.
