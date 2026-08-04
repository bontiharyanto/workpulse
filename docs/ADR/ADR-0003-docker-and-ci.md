# ADR-0003: Local development runtime & CI pipeline

- Status: Accepted
- Date: 2026-08-02
- Deciders: Platform team

## Context

Kita perlu:

1. **Onboarding predictable** untuk developer baru (satu perintah menyalakan Postgres).
2. **Image production siap-deploy** yang mencerminkan runtime nyata dan bisa dites lokal.
3. **CI otomatis** untuk menegakkan lint/typecheck/test pada setiap PR, plus verifikasi Dockerfile.

Constraint utama:

- Repo adalah **monorepo pnpm workspace + Turborepo**, artinya semua tooling harus paham struktur workspace.
- **Next.js standalone output** wajib untuk image `web` yang ramping.
- Test suite saat ini **100% unit tests** dengan Prisma di-mock — tidak butuh Postgres di CI.
- Tim kecil: hindari over-engineering (satu workflow, satu compose file).

## Decision

### Local development

- **`docker-compose.yml`** hanya menjalankan **Postgres + Adminer** secara default. Developer menjalankan `pnpm dev` langsung di host untuk hot-reload cepat.
- Compose **profile `full`** membangun image api + web dan menjalankannya bersama Postgres — dipakai untuk verifikasi image production sebelum push.
- Init script `docker/postgres/init/01-init.sql` bootstrap `workpulse_shadow` DB (butuh untuk `prisma migrate dev`).

### Container images

- **Multi-stage Dockerfile** untuk kedua app: `base` → `deps` → `build` → `runtime`.
- `apps/api/Dockerfile`:
  - Pakai `pnpm deploy --prod` untuk menghasilkan direktori self-contained dengan hanya prod deps yang sudah resolved (workspace deps ikut ter-flatten). Ini bikin final image kecil dan tidak butuh pnpm di runtime.
  - Entrypoint `tini`, user `workpulse:1001` (non-root).
  - CMD menjalankan `prisma migrate deploy` sebelum boot Nest — kontainer gagal boot bila migrasi gagal (lebih aman daripada schema drift diam-diam).
- `apps/web/Dockerfile`:
  - Gunakan **Next.js standalone output** (`output: 'standalone'` di `next.config.mjs`) dengan `outputFileTracingRoot` menunjuk ke root monorepo — Next tracing tahu file mana yang perlu di-copy ke bundle.
  - Runtime hanya berisi `.next/standalone/` + `.next/static/` + `public/`, tidak butuh pnpm/npm.
  - `NEXT_PUBLIC_API_URL` menerima `--build-arg` karena Next inline env public di build time.

### CI pipeline

- Satu workflow `.github/workflows/ci.yml` dengan dua job paralel:
  - **`verify`**: install → build shared-types → prisma generate + validate → format check → lint → typecheck → unit test → build. Semuanya di satu runner untuk menghindari overhead re-install antar job.
  - **`docker`**: build image api + web via `docker/build-push-action@v6` dengan cache GHA (`type=gha`). Image tidak di-push, hanya divalidasi build-nya.
- Concurrency dikontrol per branch: push berturut-turut membatalkan run lama.

### Repo hygiene

- **`.github/pull_request_template.md`**: checklist yang menegakkan aturan `.cursor/rules/60-repo-and-docs-standards.mdc`.
- **`.github/CODEOWNERS`**: required review untuk area sensitif (rules, docs, infra, schema).
- **`.github/dependabot.yml`**: update mingguan npm + GitHub Actions + Docker base image, dikelompokkan (types, nestjs, prisma, next, dev deps).

## Alternatives considered

1. **Postgres di CI + integration tests**. Ditunda — belum ada integration test. Struktur workflow sudah menyediakan slot; menambah `services: postgres` bila dibutuhkan hanya perlu beberapa baris.
2. **Turborepo remote cache di CI**. Ditunda — tim satu orang. Cukup pnpm store cache via `actions/setup-node@v4` sekarang.
3. **`nixpacks` / Buildpacks** alih-alih Dockerfile custom. Ditolak — kita butuh kontrol atas migrate-on-boot + user non-root + tini. Dockerfile eksplisit lebih transparan.
4. **Split verify menjadi banyak job matrix**. Ditolak untuk sekarang — overhead `actions/checkout` + install per job lebih mahal daripada waktu eksekusi step di monorepo kecil ini.
5. **Web Dockerfile tanpa standalone**. Ditolak — image runtime akan >1 GB karena membawa pnpm + workspace + node_modules lengkap. Standalone menghasilkan image ~150 MB.

## Consequences

- Developer baru: `pnpm install && docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev` — jalan dalam ~2 menit.
- Semua PR otomatis mendapat feedback: format, lint, type, test, build, Docker build. Waktu total ~4–6 menit dengan cache dingin.
- Migration selalu diverifikasi via `prisma validate` pada CI + `migrate deploy` pada startup kontainer.
- Perubahan Docker tidak "silent-broken" karena job `docker` selalu build dua image.
- Dependabot mengurangi drift versi tanpa flooding PR (grouping mingguan).

## Follow-ups

- Tambah job `integration` dengan `services: postgres` begitu kita punya suite integration test (rencana pada fase overtime + reports).
- Tambah `container-scanning` (Trivy) begitu kita mulai push image ke registry.
- Setup `release.yml` untuk push image ke GHCR pada tag `v*`.
- Aktifkan Turborepo remote cache ketika tim > 3 orang.
