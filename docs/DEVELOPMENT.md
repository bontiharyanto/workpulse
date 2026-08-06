# Development Guide

Panduan onboarding untuk engineer baru — dari clone repo sampai bisa
menjalankan aplikasi + test dalam ~30 menit.

Complement dari [CONTRIBUTING.md](../CONTRIBUTING.md) (workflow git & coding
standard) dan [ARCHITECTURE.md](./ARCHITECTURE.md) (design & layering).

---

## 1. Prasyarat

| Tool              | Versi minimum   | Cek dengan               |
| ----------------- | --------------- | ------------------------ |
| Node.js           | 20.x (LTS)      | `node --version`         |
| pnpm              | 9.x             | `pnpm --version`         |
| Docker Desktop    | 4.30+           | `docker --version`       |
| Docker Compose v2 | v2.29+          | `docker compose version` |
| Git               | any             | `git --version`          |
| PostgreSQL client | opsional (psql) | `psql --version`         |

Instal pnpm bila belum: `corepack enable && corepack prepare pnpm@latest --activate`.

macOS tips: `brew install pnpm postgresql@16` (client saja; DB pakai Docker).

---

## 2. Clone + install (5 menit)

```bash
git clone https://github.com/bontiharyanto/workpulse.git
cd workpulse
pnpm install
cp .env.example .env
```

Buka `.env` dan **wajib** ganti minimal:

- `JWT_SECRET` — string acak panjang; `openssl rand -base64 48`
- `JWT_REFRESH_SECRET` — string acak lain; jangan sama dengan `JWT_SECRET`
- `MFA_SECRET_ENCRYPTION_KEY` — `openssl rand -base64 32` (bila mau mengetes MFA)
- `TIMESHEET_EXPORT_SIGNING_SECRET` — `openssl rand -base64 32` (bila share link)

Semua env lain punya default dev yang bisa dipakai apa adanya. Referensi lengkap: [`.env.example`](../.env.example) — setiap variabel didokumentasikan di sana.

---

## 3. Jalankan stack (5 menit)

Ada **dua profile** di [`docker-compose.yml`](../docker-compose.yml):

| Profile | Yang jalan               | Kapan pakai                                            |
| ------- | ------------------------ | ------------------------------------------------------ |
| default | Postgres, MinIO, Adminer | Development normal — API & Web dari `pnpm dev` di host |
| `full`  | + API + Web container    | Verifikasi image production sebelum push               |

### 3.1 Development normal

```bash
docker compose up -d              # postgres + minio + adminer di background
pnpm db:migrate && pnpm db:seed   # buat schema + isi 4 demo user
pnpm dev                          # api → :4000, web → :3000
```

Cek hidup:

- Web: http://localhost:3000
- API: http://localhost:4000/api/v1/health
- Adminer: http://localhost:8080 (host: `postgres`, user: `workpulse`, pass: `workpulse`)
- MinIO: http://localhost:9001 (user: `workpulse`, pass: `workpulse-secret`)

Login demo:

- `admin@acme.test` / `password123` (SUPER_ADMIN)
- `hr@acme.test` / `password123` (HR_MANAGER)
- `lead@acme.test` / `password123` (SUPERVISOR)
- `employee@acme.test` / `password123` (EMPLOYEE)

Detail lengkap + skenario yang di-cover tiap user: [DEMO-USERS.md](./DEMO-USERS.md).

### 3.2 Data UAT (28 karyawan, timesheet, backlog, MFA, konsen)

```bash
pnpm db:seed:uat
```

Ini menambahkan skenario realistis untuk UAT: 28 karyawan di 5 departemen,
timesheet SUBMITTED bulan lalu, backlog OT overdue, user MFA-enabled, user
konsen kadaluarsa, audit log sample, notifikasi unread. Detail scenario di
[UAT-E2E.md](./UAT-E2E.md).

### 3.3 Port konflik

Bila 3000/4000/5432/8080/9000/9001 sudah dipakai project lain (mis. Controldesk),
override lewat env sebelum `docker compose up`:

```bash
export POSTGRES_HOST_PORT=15432
export API_HOST_PORT=14000
export WEB_HOST_PORT=13000
export MINIO_S3_HOST_PORT=19000
export MINIO_CONSOLE_HOST_PORT=19001
export ADMINER_HOST_PORT=18080
docker compose up -d
```

Container-internal port tidak berubah — jadi URL container-to-container tetap stabil.

---

## 4. Perintah harian

Semua dijalankan dari **root repo** kecuali disebutkan.

### 4.1 Development

```bash
pnpm dev                             # start api + web (turbo parallel)
pnpm --filter @workpulse/api dev     # start api saja
pnpm --filter @workpulse/web dev     # start web saja
```

### 4.2 Database

```bash
pnpm db:migrate                      # dev flow: buat migration dari schema.prisma
pnpm db:migrate:status               # cek migration mana yang belum applied
pnpm db:migrate:reset                # DEV ONLY — hapus DB, apply ulang, run seed
pnpm db:seed                         # baseline seed (4 user)
pnpm db:seed:uat                     # UAT seed (28 user + fixtures)
pnpm db:studio                       # buka Prisma Studio di :5555
pnpm db:generate                     # regenerate Prisma Client
```

Detail workflow migration di [MIGRATIONS.md](./MIGRATIONS.md).

### 4.3 Test

```bash
pnpm test                            # unit test semua workspace (kecuali E2E)
pnpm --filter @workpulse/api test    # unit test API saja
pnpm --filter @workpulse/api test -- --watch  # watch mode
pnpm --filter @workpulse/api test -- --changedSince=main
pnpm e2e                             # E2E Playwright (chromium)
pnpm e2e:headed                      # E2E dengan browser visible
pnpm e2e:ui                          # Playwright UI mode
```

Strategi test: [TESTING.md](./TESTING.md).

### 4.4 Kualitas kode

```bash
pnpm format:check                    # cek Prettier
pnpm format                          # auto-fix Prettier
pnpm lint                            # ESLint semua workspace
pnpm typecheck                       # TypeScript --noEmit semua workspace
pnpm build                           # build semua workspace
```

Sebelum push, mirror pipeline CI:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

### 4.5 Docker

```bash
docker compose ps                    # status container
docker compose logs -f api           # tail log API
docker compose logs -f postgres      # tail log Postgres
docker compose --profile full up --build  # verifikasi image production
docker compose down                  # stop, keep data
docker compose down -v               # stop + hapus volume (reset DB)
```

---

## 5. Layout monorepo

```
workpulse/
├── apps/
│   ├── api/                         # NestJS backend (:4000)
│   │   ├── src/
│   │   │   ├── attendance/          # tiap feature = folder
│   │   │   │   ├── attendance.module.ts
│   │   │   │   ├── attendance.controller.ts
│   │   │   │   ├── attendance.service.ts
│   │   │   │   ├── dto/
│   │   │   │   └── domain/          # pure functions, bebas framework
│   │   │   ├── auth/                # JWT + guards
│   │   │   ├── common/              # filters, interceptors, decorators
│   │   │   ├── config/              # env validation (Zod)
│   │   │   └── prisma/              # PrismaService singleton
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       ├── migrations/
│   │       ├── seed.ts              # baseline seed
│   │       └── seed-uat.ts          # UAT scenario seed
│   ├── web/                         # Next.js frontend (:3000)
│   │   ├── app/
│   │   │   ├── (auth)/              # login, konsen — non-authenticated
│   │   │   ├── (dashboard)/         # authenticated shell
│   │   │   └── api/                 # route handlers (proxy ringan)
│   │   ├── components/
│   │   │   ├── features/            # per-domain: attendance, leave, dsb.
│   │   │   ├── ui/                  # shadcn primitives
│   │   │   └── layout/              # shell, header, sidebar
│   │   └── lib/                     # utilities, hooks, api client
│   ├── e2e/                         # Playwright E2E suite
│   │   ├── tests/                   # 30+ .spec.ts
│   │   ├── fixtures/                # kredensial user
│   │   ├── helpers/                 # login, api, dates, cleanup
│   │   └── playwright.config.ts
│   └── load-test/                   # k6 load scenario (opsional)
├── packages/
│   ├── shared-types/                # Zod schema + TS types (dipakai api & web)
│   └── config/                      # ESLint, TS, Prettier preset
├── docs/                            # semua dokumen — mulai dari docs/README.md
├── prisma/                          # (schema utama tetap di apps/api/prisma/)
├── docker-compose.yml               # postgres, minio, adminer + full profile
├── .env.example                     # canonical env reference
├── package.json                     # root scripts (turbo)
└── turbo.json                       # pipeline definition
```

Setiap folder di `apps/api/src/<feature>/` mengikuti pola **module → controller (tipis) → service (orkestrasi + tx) → domain (pure)**. Lihat [ARCHITECTURE.md §3](./ARCHITECTURE.md).

---

## 6. Alur menambah fitur baru

Skenario: menambah endpoint `POST /me/preferences/theme` untuk simpan pilihan tema per user.

1. **Design** — ADR bila lintas modul; tidak perlu bila kecil (< 100 LoC).
2. **Schema** (bila menyentuh DB):
   ```bash
   $EDITOR apps/api/prisma/schema.prisma           # tambah field
   pnpm db:migrate                                  # generate migration
   ```
3. **DTO + Zod schema:**
   - Backend DTO: `apps/api/src/user/dto/update-theme.dto.ts` (class-validator).
   - Zod schema: `packages/shared-types/src/user.ts` (dipakai FE + BE).
4. **Service:** logic di `apps/api/src/user/user.service.ts`. Wrap multi-step write dalam `prisma.$transaction`.
5. **Controller:** tipis — hanya route + guard + delegasi ke service.
6. **Guard:** `@UseGuards(JwtAuthGuard)` minimal; `@Roles(...)` bila perlu.
7. **Unit test:** `apps/api/src/user/user.service.spec.ts` — mock Prisma via `jest-mock-extended`.
8. **Audit log** bila mutasi sensitif — tulis ke `AuditLog` dalam transaksi yang sama.
9. **Frontend:**
   - Form: `apps/web/components/features/settings/theme-form.tsx` + RHF + Zod resolver.
   - Fetch: TanStack Query di `apps/web/lib/api/user.ts`.
10. **E2E** bila alur lintas role: tambahkan spec di `apps/e2e/tests/`.
11. **Docs:** update [API.md](./API.md) bila endpoint publik; update [WORKFLOW.md](./WORKFLOW.md) bila alur bisnis.
12. **PR** — checklist di [`.github/pull_request_template.md`](../.github/pull_request_template.md).

---

## 7. Troubleshooting umum

### "Failed to fetch" di login page

Biasanya `NEXT_PUBLIC_API_URL` tidak sesuai atau API belum jalan.

- Cek: `curl http://localhost:4000/api/v1/health` — harus `{"status":"ok"}`.
- Cek: `NEXT_PUBLIC_API_URL` di `.env` **sama persis** dengan URL API yang bisa diakses browser (host + port).
- Kalau pakai remap port lewat Docker profile `full`, `NEXT_PUBLIC_API_URL` di web container **harus** menunjuk ke `http://api:4000` (nama service), bukan `localhost`.

### `pnpm db:migrate` gagal — shadow database error

Prisma butuh dua DB untuk migrate: `workpulse` dan `workpulse_shadow`. Pastikan
`SHADOW_DATABASE_URL` di-set dan superuser `workpulse` bisa `CREATE DATABASE`.

```bash
docker exec -it $(docker compose ps -q postgres) psql -U workpulse -c "CREATE DATABASE workpulse_shadow;"
```

### E2E test `waitForURL` timeout

Kadang flaky di CI. Reset DB lalu re-run:

```bash
pnpm db:migrate:reset && pnpm e2e --workers=1
```

Prinsip test hygiene: [ADR-0015](./ADR/ADR-0015-e2e-test-hygiene.md).

### "Insufficient balance" saat submit leave meski quota masih ada

Kemungkinan: balance version conflict (optimistic locking). Refresh browser
dan submit ulang. Bila persisten, cek `LeaveBalance.version` di DB —
mungkin ada tabel drift. Lihat [WORKFLOW.md — Leave](./WORKFLOW.md#leave).

### Login sukses tapi selalu redirect ke `/consent`

Berarti user belum accept privacy policy versi terbaru. Ini **by design**
untuk kepatuhan UU PDP. Detail: [ADR-0022](./ADR/ADR-0022-retention-and-consent.md).

Bypass hanya untuk test — set `PRIVACY_POLICY_ACCEPT_REQUIRED=false` di dev.

### Docker `permission denied` di macOS

Restart Docker Desktop; pastikan folder repo ada di **File Sharing** setting.

---

## 8. IDE setup (VS Code / Cursor)

Extension yang direkomendasikan (ada `settings.json` template di [`.vscode/`](../.vscode/) bila sudah dibuat):

- **ESLint** (`dbaeumer.vscode-eslint`) — auto-fix on save.
- **Prettier** (`esbenp.prettier-vscode`) — set sebagai default formatter.
- **Prisma** (`prisma.prisma`) — syntax highlight + intellisense schema.
- **Playwright Test for VSCode** (`ms-playwright.playwright`) — jalankan test dari editor.
- **Tailwind CSS IntelliSense** (`bradlc.vscode-tailwindcss`) — autocomplete class.
- **Error Lens** (`usernamehw.errorlens`) — inline diagnostic.

Setting minimum di `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "eslint.workingDirectories": [{ "pattern": "apps/*" }, { "pattern": "packages/*" }]
}
```

---

## 9. Bacaan lanjutan

Setelah bisa menjalankan aplikasi:

1. **[ARCHITECTURE.md](./ARCHITECTURE.md)** — layering, cross-cutting concerns, concurrency.
2. **[WORKFLOW.md](./WORKFLOW.md)** — alur bisnis lengkap (attendance, leave, overtime, timesheet, approval).
3. **[API.md](./API.md)** — REST API surface, konvensi error, versioning.
4. **[TESTING.md](./TESTING.md)** — strategi unit + E2E, konvensi fixture.
5. **[GLOSSARY.md](./GLOSSARY.md)** — kamus istilah domain.
6. Baca **ADR** sesuai fitur yang akan Anda sentuh — daftar di [docs/README.md §4](./README.md#4-direktori-adr-architecture-decision-records).

---

_Bila ada langkah yang stuck > 15 menit, buka issue atau tanya di
`#workpulse-dev` — dokumentasi ini terus diperbaiki._
