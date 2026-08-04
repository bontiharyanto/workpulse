# Migration Workflow

Workpulse menggunakan **Prisma Migrate** untuk manajemen schema database.
Semua migration file di-track di `apps/api/prisma/migrations/` dan **wajib
di-commit ke git** — jangan pakai `prisma db push` untuk perubahan permanen.

## TL;DR — perintah yang sering dipakai

| Perintah | Kapan dipakai |
|---|---|
| `pnpm --filter @workpulse/api prisma:migrate` | Dev flow: baru saja edit `schema.prisma` |
| `pnpm --filter @workpulse/api prisma:migrate:create-only` | Butuh edit migration.sql secara manual (partial unique, raw SQL, dsb.) |
| `pnpm --filter @workpulse/api prisma:migrate:deploy` | Production/staging deploy |
| `pnpm --filter @workpulse/api prisma:migrate:status` | Cek migration mana yang belum di-apply |
| `pnpm --filter @workpulse/api prisma:migrate:reset` | **DEV ONLY** — hapus DB, apply ulang semua migration, run seed |

## Alur Standar (99% kasus)

1. Edit `apps/api/prisma/schema.prisma` (tambah field, relasi, index, dst.).
2. Jalankan `prisma:migrate` — Prisma akan:
   - Membangun **shadow database** dari migration existing
   - Membandingkan dengan schema baru
   - Generate file `prisma/migrations/<timestamp>_<name>/migration.sql`
   - Apply migration ke dev database
   - Regenerate Prisma Client
3. Beri nama deskriptif saat prompt (mis. `add_notification_settings`).
4. Review file `migration.sql` sebelum commit — pastikan SQL benar dan aman.
5. Commit **schema.prisma + migration folder** bersama-sama dalam satu commit.

## Migration Immutability

Setelah sebuah migration di-merge ke `main`, **JANGAN mengubah file `migration.sql`
yang sudah ada.** Setiap perubahan schema baru → migration file baru.

Kenapa: `prisma migrate deploy` membandingkan checksum file dengan yang tersimpan
di tabel `_prisma_migrations`. Modifikasi in-place → deploy gagal di production.

Jika migration terlanjur dirilis dengan bug:
- **Ringan** (mis. rename kolom): buat migration baru yang meng-undo/rename.
- **Berat** (mis. data loss): koordinasi dengan tim ops untuk downtime + manual fix.

## Special Case — Raw SQL yang Tidak Di-track Prisma

Beberapa fitur Postgres (partial index, `CHECK` constraint kompleks, extension
custom, materialized view) **tidak dimodel** oleh Prisma DSL. Kita tetap
menggunakannya via **raw SQL** di dalam migration file, dengan konvensi berikut:

### Contoh: Partial Unique Index

Di `20260801190000_add_overtime_indexes_and_partial_unique/migration.sql`:

```sql
CREATE UNIQUE INDEX "OvertimeRequest_userId_workDate_active_uidx"
  ON "OvertimeRequest" ("userId", "workDate")
  WHERE "status" IN ('PENDING_APPROVAL', 'APPROVED', 'COMPLETED')
    AND "deletedAt" IS NULL;
```

Ini **tidak dideklarasikan** di `schema.prisma` karena Prisma DSL belum
mendukung partial unique.

### Konsekuensi & Cara Menjaga

Ketika kamu menjalankan `prisma migrate dev` di masa depan:

- Prisma membangun shadow DB dari **semua** migration → shadow DB memiliki
  partial unique.
- Prisma membandingkan shadow DB dengan schema.prisma yang sekarang.
- Prisma **akan berpikir** partial unique adalah "drift" dan menawarkan
  migration `DROP INDEX ...`.

**⚠️ JANGAN accept migration yang men-DROP index dengan suffix `_uidx` atau
`_active_uidx`.** Alur yang benar:

1. Jalankan `pnpm prisma:migrate:create-only` (BUKAN `prisma:migrate`).
   Flag `--create-only` men-generate file tanpa langsung apply.
2. Buka file migration yang baru dibuat.
3. **Hapus** statement `DROP INDEX "...uidx"` — Prisma tidak paham index ini
   memang manual.
4. Simpan, lalu jalankan `prisma:migrate` untuk apply.

Semua index/constraint manual harus terdaftar di section [Registry](#registry-index-constraint-manual)
di bawah.

## Registry — Index & Constraint Manual

Setiap kali menambahkan raw SQL yang tidak dimodel Prisma, **tambahkan entri
di sini**. Ini adalah checklist bagi reviewer PR untuk mengingatkan
"jangan biarkan `prisma migrate dev` men-DROP ini".

| Object | Type | Migration | Alasan Tidak Dimodel |
|---|---|---|---|
| `OvertimeRequest_userId_workDate_active_uidx` | Partial UNIQUE INDEX | `20260801190000_add_overtime_indexes_and_partial_unique` | Prisma DSL belum support partial unique; melindungi race concurrent submit sambil mengizinkan retry setelah REJECTED/CANCELLED. |

## Production Deploy Checklist

Sebelum deploy ke staging/production:

1. **Pastikan branch punya semua migration terbaru** — `git pull` + `pnpm prisma:migrate:status`.
2. **Backup database** (`pg_dump`) sebelum apply migration destructive (DROP COLUMN, DROP TABLE, ALTER TYPE, dsb.).
3. Jalankan `pnpm prisma:migrate:deploy` (bukan `prisma:migrate`) — command ini:
   - Hanya menerapkan migration yang belum di-apply
   - **Tidak** membangun shadow DB (aman untuk production)
   - Gagal kalau ada migration yang checksum-nya berubah
4. Verify dengan `pnpm prisma:migrate:status` — semua "Applied".
5. Rilis app version yang menggunakan schema baru.

**Best practice:** deploy migration + code baru secara berurutan, jangan
paralel. Roll-forward strategy: migration harus **backward-compatible** dengan
kode lama untuk beberapa menit selama rolling deploy (mis. tambah kolom
nullable dulu, isi data, baru NOT NULL di migration terpisah kemudian).

## Zero-Downtime Rules of Thumb

| Perubahan | Aman? | Catatan |
|---|---|---|
| Tambah kolom nullable | ✅ | Kode lama abaikan; kode baru mulai mengisi. |
| Tambah kolom NOT NULL dengan DEFAULT | ✅ | Postgres 11+ tidak rewrite tabel. |
| Tambah kolom NOT NULL tanpa DEFAULT | ❌ | Butuh 2-step: nullable → backfill → NOT NULL. |
| Tambah index concurrent | ✅ | Manual raw SQL `CREATE INDEX CONCURRENTLY` — tidak lock tabel. |
| DROP kolom | ⚠️ | Kode yang masih SELECT kolom itu akan error. Rilis kode dulu, migration kemudian. |
| RENAME kolom/tabel | ❌ | Sama seperti DROP. Pakai 2-step: add new + backfill + drop old. |
| ALTER TYPE enum add value | ✅ | Postgres 12+ non-blocking untuk ADD (tapi DROP masih locking). |

## Seed Data

`prisma/seed.ts` di-invoke otomatis setelah `prisma:migrate:reset` dan
tersedia via `pnpm prisma:seed`. Isi seed:

- 1 Company demo (slug `acme`)
- 4 User (SUPER_ADMIN, HR_MANAGER, SUPERVISOR, EMPLOYEE) — password `password123`
- 1 Geofence + 1 Shift + LeaveType dasar + Holiday sample

Seed **tidak** dijalankan di production. Untuk onboarding tenant baru gunakan
admin UI (`/admin/company`, `/admin/users`, dsb.).

## Common Errors & Fixes

### `Environment variable not found: DATABASE_URL`

Prisma butuh `DATABASE_URL` untuk shadow DB juga. Set di `.env.local` atau
export sebelum menjalankan command.

### `P3006 Migration <name> failed to apply cleanly to the shadow database`

Migration SQL kamu punya error syntax atau conflict dengan state existing.
Jalankan SQL manual di Postgres untuk debug. Jangan langsung `--force`.

### `P3018 A migration failed to apply` di production

**JANGAN** ubah migration file yang sudah gagal. Sebaliknya:
1. Fix root cause (mis. bug SQL) di migration baru.
2. Jalankan `prisma migrate resolve --applied <failed_migration_name>` untuk
   menandai yang gagal sebagai "applied" (kalau data-nya sudah manual di-fix).
3. Deploy migration baru.

### `_prisma_migrations` table missing atau corrupt

Sudah pernah pakai `prisma db push` di database yang sama. Jalankan:
```
prisma migrate resolve --applied 20260801184814_init
```
untuk register init migration sebagai applied tanpa re-run SQL.
