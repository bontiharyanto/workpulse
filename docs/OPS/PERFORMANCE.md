# Workpulse — Performance & Capacity Plan

Panduan sizing + procedure load test untuk pilot SMB Indonesia.

---

## 1. Filosofi

- **Ukur, jangan tebak.** Setiap keputusan sizing harus didukung run k6 baseline (`apps/load-test/scenarios/baseline.js`) di staging environment yang mirror-produksi.
- **Left-shift regressions.** k6 baseline masuk ke CI (`.github/workflows/load-test.yml`). PR yang menaikkan p95 latency > 20% otomatis fail — kecuali ada ADR yang menjelaskan trade-off.
- **Right-size, jangan overprovision.** Untuk pilot 1–10 tenant, satu VPS 4 GB cukup. Over-provisioning "just in case" adalah waste.

---

## 2. Target SLO

Baseline yang harus dijaga setiap release (di lingkungan setara VPS baseline, latency user di area Indonesia < 100 ms):

| Metric                                                          |                                                        Target | Threshold di k6                             |
| --------------------------------------------------------------- | ------------------------------------------------------------: | ------------------------------------------- |
| Read p95 (`GET /me`, `GET /admin/*`, `GET /analytics/*`)        |                                                  **≤ 300 ms** | `baseline_read_ms: p(95)<300`               |
| Write p95 (`POST /attendance/clock-in`, `POST /leave/requests`) |                                                  **≤ 600 ms** | `baseline_write_ms: p(95)<600`              |
| Export p95 (`POST /admin/timesheets/exports`)                   | **≤ 5 s** (CSV summary) / **≤ 15 s** (XLSX detail 1000+ rows) | `baseline_export_ms: p(95)<5000`            |
| Global 5xx rate                                                 |                                                    **≤ 0.1%** | `http_req_failed: rate<0.001` (dari Sentry) |
| Global error rate (5xx + kegagalan bisnis unexpected)           |                                                      **≤ 1%** | `baseline_errors: rate<0.02`                |
| Uptime bulanan                                                  |                         **≥ 99.5%** (Beta) → **≥ 99.9%** (GA) | External monitor                            |

Angka-angka di atas juga di-encode ke `apps/load-test/lib/config.js` (`SLO_*`). Bisa di-override runtime dengan env untuk experiment tapi jangan diubah tanpa ADR.

---

## 3. Sizing Reference (per Beta baseline)

| Tenant size                        | DAU (Daily Active) | Peak clock-in/s | VPS                                               | DB size | Storage attach | Egress/bulan |
| ---------------------------------- | -----------------: | --------------: | ------------------------------------------------- | ------: | -------------: | -----------: |
| **XS** — 1 tenant × ≤50 karyawan   |               ≤ 40 |               3 | Hetzner CX22 (2 vCPU / 2 GB)                      | ~200 MB |        ~200 MB |       ~10 GB |
| **S** — 1–3 tenant × 200 karyawan  |               ~200 |              20 | Hetzner CX32 (2 vCPU / 4 GB) — **BASELINE**       |   ~2 GB |          ~2 GB |       ~40 GB |
| **M** — 5–10 tenant × 500 karyawan |              ~1500 |             100 | Hetzner CX42 (4 vCPU / 8 GB) + Neon Pro DB        |  ~15 GB |         ~15 GB |      ~150 GB |
| **L** — 20+ tenant × 1000+         |              ~5000 |             500 | K8s cluster (3 nodes) + Neon Scale + Read replica |  ~80 GB |         ~80 GB |      ~800 GB |

**Beta target = kolom S**. Semua rekomendasi di dokumen ini di-tune untuk kolom S kecuali dinyatakan lain.

---

## 4. Load Test Playbook

### 4.1. Kapan?

- **Wajib**: sebelum setiap release rilis mayor (Q1/Q2 milestone).
- **Direkomendasikan**: setiap merge ke `main` yang menyentuh service critical (attendance, timesheet, dashboard).
- **Otomatis**: CI job `.github/workflows/load-test.yml` triggered pada tag `v*` — jalankan `baseline.js`, upload artifact, komentar hasil ke PR release.

### 4.2. Prasyarat lingkungan staging

- Compose stack identik dengan produksi.
- Seed data: minimum 1 tenant + 500 seed employees + 30 hari attendance history + 5 shift + 1 timesheet period.
- 2 JWT loadtest (EMPLOYEE + HR_MANAGER) di-provision via seed script.
- **Sentry DSN Staging berbeda** — data load-test tidak boleh mengotori error triage prod.

### 4.3. Jalankan drill lengkap

```bash
cd apps/load-test

# 0. Smoke — 30s
API_URL=https://staging.workpulse.local k6 run scenarios/smoke.js

# 1. Clock-in burst — 90s total
EMPLOYEE_JWT=... k6 run scenarios/clock-in-burst.js

# 2. Dashboard read — 3 min
HR_JWT=... k6 run scenarios/dashboard-read.js

# 3. Timesheet export — 2 min
HR_JWT=... k6 run scenarios/timesheet-export.js

# 4. Baseline mixed — 5 min (yang paling penting untuk regression tracking)
EMPLOYEE_JWT=... HR_JWT=... k6 run --out json=baseline-$(date -u +%Y%m%d).json \
  scenarios/baseline.js
```

Simpan output JSON ke folder `docs/OPS/baselines/` dan commit — histori perf tercatat di git.

---

## 5. Bottleneck yang Diperkirakan (untuk baseline S)

Prediksi berdasarkan profil arsitektur (belum divalidasi angka nyata sampai run pertama). Setelah baseline pertama, update baris ini dengan angka aktual + link ke Sentry Performance trace.

| Endpoint                    | Bottleneck utama                                            | Mitigasi (Beta)                                              | Mitigasi (post-Beta)                         |
| --------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| `POST /attendance/clock-in` | Prisma `INSERT` + geofence Haversine + audit log dalam 1 tx | Index `Attendance(userId, date)`; connection pool 20         | Move geofence check ke PostGIS spatial query |
| `GET /analytics/dashboard`  | Aggregation multi-tabel real-time                           | Materialized `AnalyticsSnapshot` (sudah ada di Fase 33a)     | Redis cache 60 s TTL                         |
| `POST /timesheet/exports`   | XLSX generation via `exceljs` in-memory                     | Bounded buffer + audit-before-stream (sudah ada di Fase 32d) | Offload ke worker queue (BullMQ)             |
| `GET /notifications`        | Sort by `createdAt DESC` unbounded                          | LIMIT 50 + cursor pagination (implemented)                   | —                                            |
| `POST /me/data-export`      | ZIP zip stream + all tables scan                            | Async worker + cooldown 24h (Fase 31a)                       | Partition per tenant                         |

---

## 6. Postgres Tuning (baseline S)

Nilai-nilai ini di-set di `docker-compose.prod.yml` service `postgres`:

| Setting                      | Nilai baseline | Alasan                                                               |
| ---------------------------- | -------------: | -------------------------------------------------------------------- |
| `shared_buffers`             |         512 MB | ~1/4 RAM VPS 4 GB. Postgres 16 sweet spot.                           |
| `effective_cache_size`       |        1536 MB | ~3/4 RAM. Membantu planner memilih index scan.                       |
| `maintenance_work_mem`       |         128 MB | Untuk VACUUM/index build tanpa mem-freeze DB.                        |
| `work_mem`                   |           8 MB | Per query, per operation. 8 MB × 20 connections = 160 MB worst case. |
| `max_connections`            |            100 | Prisma connection_limit=20 → 5 API instance headroom.                |
| `log_min_duration_statement` |           1000 | Log query > 1 detik. Kirim log ke Loki/Grafana untuk analisis.       |

**Jangan bump `shared_buffers` > 25% RAM** — diminishing returns dan bikin OS cache lapar.

Untuk tuning lebih dalam pasca-launch, aktifkan `pg_stat_statements` extension:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SELECT query, calls, total_exec_time, rows FROM pg_stat_statements
ORDER BY total_exec_time DESC LIMIT 20;
```

---

## 7. Frontend Performance

Diluar cakupan load test API tapi tetap dipantau lewat Core Web Vitals:

| Metric                         |       Target Beta | Dukungan bawaan                                   |
| ------------------------------ | ----------------: | ------------------------------------------------- |
| LCP (Largest Contentful Paint) |           ≤ 2.5 s | Next.js RSC + Caddy gzip/zstd                     |
| FID / INP                      | ≤ 100 ms / 200 ms | Minimal client bundle (server components dominan) |
| CLS                            |             ≤ 0.1 | Layout stability, no image jump                   |

Web Vitals di-report ke Sentry via `apps/web/lib/vitals.ts` (kalau belum ada, tambahkan sebagai OPS-4 sub-task).

---

## 8. Kesimpulan (siapkan pilot)

- Setiap release wajib melewati `baseline.js` di staging.
- Semua threshold di-encode ke k6 (fail-fast pada regression).
- VPS baseline S (4 GB / 2 vCPU) cukup untuk 1–3 tenant × 200 karyawan.
- Kalau baseline drift > 20%: file P1 ticket + PR fix atau justifikasi ADR sebelum tag production.

Update dokumen ini setelah baseline run pertama diselesaikan. Kolom "Baseline aktual" di `apps/load-test/README.md` juga wajib diisi.
