# ADR-0001 — Monorepo, Tech Stack, and DDD Structure

- **Status:** Accepted
- **Date:** 2026-08-01
- **Deciders:** Founding engineering team

## Context

Workpulse akan berkembang cepat: multiple modul bisnis (kehadiran, cuti, izin, lembur, laporan), multiple klien (web, mungkin mobile), dan tim yang berkembang. Kita perlu memilih:

1. Bagaimana meng-host semua kode: mono-repo atau poly-repo?
2. Framework backend dan frontend yang mendukung TypeScript penuh, RBAC, dan iterasi cepat.
3. Pola arsitektur di dalam backend agar logika bisnis mudah di-test dan tidak terikat framework.

## Decision

### 1. Monorepo dengan pnpm workspaces + Turborepo

- **Rasional:**
  - Type-sharing FE↔BE lebih rapi tanpa versioning package terpisah (schema Zod jadi single source of truth di `packages/shared-types`).
  - Perubahan lintas-layer (endpoint baru + form baru) bisa jadi satu PR.
  - Turborepo memberikan cache remote & task pipeline yang cepat untuk CI.
- **Alternatif yang ditolak:**
  - Poly-repo → overhead sync types (ndep `openapi-generator`, dsb.), CI lebih kompleks.
  - Nx → powerful tapi lebih opinionated & generator-heavy; Turbo cukup untuk kebutuhan.

### 2. Backend: NestJS + Prisma + PostgreSQL

- **Rasional:**
  - NestJS memberikan struktur (Modules, DI, Guards, Interceptors) yang sesuai untuk aplikasi enterprise besar dengan tim yang tumbuh.
  - Prisma memberikan type-safety end-to-end dan migrasi yang aman.
  - PostgreSQL: transaksi solid, ekstensi PostGIS bila nanti butuh spatial query.
- **Alternatif yang ditolak:**
  - Express + zod + drizzle → lebih ringan tapi butuh reinvent banyak infrastruktur (RBAC, DI, filter).
  - Fastify plain → sama seperti di atas.

### 3. Frontend: Next.js App Router + Tailwind + Shadcn + TanStack Query

- **Rasional:**
  - RSC untuk data-fetching awal → less client JS.
  - Shadcn + Radix → accessible primitives yang bisa dikustom sepenuhnya.
  - TanStack Query untuk state server-side yang interaktif (dashboard, live update).
- **Alternatif yang ditolak:**
  - SPA (Vite + React Router) → butuh membangun ulang SSR/SEO/route handlers.
  - Remix → matang tapi ecosystem UI/mutation < Next.

### 4. Struktur DDD di dalam modul backend

Setiap feature module memiliki subfolder `domain/` berisi pure functions & value objects (geofence, timing, saldo). Ini membuat:

- Unit test cepat (tanpa Nest bootstrap).
- Logika bisnis tidak menempel pada framework atau ORM.

## Consequences

**Positif:**

- Iterasi lintas-stack cepat.
- Type-safety kuat dari DB → API → UI.
- Test domain layer bisa berjalan < 1 detik.

**Negatif / Trade-off:**

- Onboarding developer baru perlu memahami: pnpm workspaces, Turborepo pipelines, Nest DI, Prisma. Investasi awal ~1 minggu.
- Monorepo → CI harus pintar (Turbo cache, affected-only test) agar tidak lambat setelah repo membesar.

## Follow-ups

- ADR-0002: pemilihan strategi auth (session cookie vs bearer + refresh).
- ADR-0003: strategi backup & DR PostgreSQL.
- ADR-0004: kapan mengadopsi PostGIS vs Haversine JS.
