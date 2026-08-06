# Contributing to Workpulse

Terima kasih sudah tertarik berkontribusi. Dokumen ini memformalkan cara kerja tim & AI assistant pada repositori ini.

> Baru pertama kali menyentuh repo? Baca [Development Guide](./docs/DEVELOPMENT.md)
> lebih dulu (setup 30 menit) — dokumen ini fokus di **workflow git + coding
> standard**, sedangkan Development Guide fokus di **cara menjalankan** aplikasi.
> Peta lengkap semua dokumen: [Documentation Portal](./docs/README.md).

## Development Workflow

1. **Sync main**: `git checkout main && git pull`.
2. **Branch baru** dari `main`.
3. Implementasi + tulis test.
4. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` — semua harus hijau (mirror pipeline CI).
5. **PR** ke `main`, minta 1 reviewer minimal. GitHub Actions akan menjalankan `verify` + `docker` build.
6. Merge via **squash & merge** — commit message mengikuti Conventional Commits.

## Local Environment

Cara paling cepat:

```bash
pnpm install
cp .env.example .env
docker compose up -d          # Postgres + Adminer di background
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Verifikasi image production sebelum push perubahan Dockerfile:

```bash
docker compose --profile full up --build
# api → http://localhost:4000/api/v1/health
# web → http://localhost:3000
```

Bila mengubah `apps/*/Dockerfile`, `docker-compose.yml`, atau `.github/workflows/ci.yml`, jalankan `docker compose build` lokal untuk memastikan build hijau sebelum PR.

## Branch Naming

| Prefix             | Ketika                            |
| ------------------ | --------------------------------- |
| `feat/<scope>`     | fitur baru                        |
| `fix/<scope>`      | bugfix                            |
| `refactor/<scope>` | refactor tanpa perubahan behavior |
| `chore/<scope>`    | tooling, config, deps             |
| `docs/<scope>`     | dokumentasi saja                  |
| `perf/<scope>`     | perbaikan performa                |
| `test/<scope>`     | menambah/memperbaiki test         |

Scope contoh: `attendance`, `leave`, `auth`, `web`, `api`, `prisma`.

## Commit Message — Conventional Commits

```
feat(leave): add multi-level approval workflow

* supervisor approval creates PENDING_HR record
* HR manager decision writes AuditLog and adjusts LeaveBalance atomically
* adds RolesGuard for /leave/:id/approve
```

## Coding Standards

Sudah dijaga otomatis via `.cursor/rules/*.mdc` dan ESLint. Poin utama:

- **Bahasa:** kode & komentar **English**; komunikasi tim & PR description **boleh Bahasa Indonesia**.
- **Types:** tanpa `any`, tanpa non-null assertion (`!`) tanpa komentar justifikasi.
- **Backend:** logika bisnis di service; controller tipis; DTO wajib untuk setiap payload; multi-step write ⇒ `prisma.$transaction`.
- **Frontend:** default RSC; `"use client"` hanya bila perlu; form wajib RHF + Zod; jangan fetch di `useEffect` untuk data awal.
- **Security:** Geofence & permission check **selalu server-side**. Row-level tenant filter di setiap query.
- **Audit:** setiap perubahan data sensitif tulis ke `AuditLog` dalam transaksi yang sama.

## Testing Discipline

- **Domain unit tests:** wajib untuk logika bisnis non-trivial (`apps/api/src/**/domain/*.ts`).
- **Service tests:** mock `PrismaService` via `jest-mock-extended`.
- **E2E:** dengan `@nestjs/testing` + Testcontainers untuk Postgres (opsional pada fase awal).

Jalankan test terkait sebelum push:

```bash
pnpm --filter @workpulse/api test -- --changedSince=main
```

## Prisma Migrations

- Setiap perubahan schema membutuhkan **satu migrasi Prisma** (`prisma migrate dev --name <descriptive>`).
- Migrasi yang sudah di-merge tidak boleh diedit; tulis migrasi kompensasi (add → backfill → cutover → drop) untuk perubahan destruktif.
- **Jangan** jalankan `prisma db push` selain di sandbox lokal.

## PR Checklist

Setiap PR wajib mencentang:

- [ ] Judul mengikuti Conventional Commits.
- [ ] Deskripsi menjelaskan **mengapa**, bukan sekadar **apa**.
- [ ] DTO / Zod schema ditambah/diperbarui bila endpoint atau form berubah.
- [ ] Migrasi Prisma dibuat bila schema berubah.
- [ ] Unit test baru menyertai perubahan domain logic.
- [ ] `AuditLog` dipanggil untuk operasi sensitif.
- [ ] RBAC & tenant scoping diverifikasi (guard + query filter).
- [ ] Dokumentasi diperbarui (`docs/WORKFLOW.md` untuk perubahan bisnis, `docs/ARCHITECTURE.md` untuk perubahan struktural, `docs/API.md` bila endpoint publik berubah).
- [ ] Bila mengubah Dockerfile atau CI: verifikasi `docker compose --profile full up --build` sukses secara lokal.
- [ ] Tidak ada `any`, `TODO`, `console.log`, atau secret yang bocor.

## Reporting Bugs / Security

Bug produksi & isu keamanan: buka issue dengan label `bug` / `security`. Untuk isu keamanan yang sensitif, gunakan channel internal tim, jangan public issue.
