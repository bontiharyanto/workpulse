# Workpulse — Load Test Suite (k6)

Tooling untuk mengukur baseline performance dan mendeteksi regresi antar rilis.

---

## Scope

| Skenario         | File                            | Beban                      | Tujuan                                            |
| ---------------- | ------------------------------- | -------------------------- | ------------------------------------------------- |
| Smoke            | `scenarios/smoke.js`            | 1 VU × 30 s                | Sanity check target env                           |
| Clock-in Burst   | `scenarios/clock-in-burst.js`   | 250 req/s selama 30 s      | Peak jam 08:00 (500 karyawan clock-in dalam 60 s) |
| Dashboard Read   | `scenarios/dashboard-read.js`   | 40 VU × 3 min              | HR viewing dashboard + list                       |
| Timesheet Export | `scenarios/timesheet-export.js` | 5 VU × 2 min               | Payroll async export (CSV/XLSX)                   |
| Baseline Mixed   | `scenarios/baseline.js`         | 30 VU × 5 min, mix 70/28/2 | Release-over-release comparison                   |

---

## Prasyarat

1. Install k6 lokal (macOS: `brew install k6`, Linux: `sudo apt install k6` setelah `wget https://dl.k6.io/key.gpg`).
2. Target env harus reachable (`export API_URL=https://staging.workpulse.local`).
3. Seed data:
   - Minimal 1 tenant + 1 shift dengan geofence Bundaran HI (`-6.19511, 106.82302`).
   - 1 user `EMPLOYEE` + 1 user `HR_MANAGER`.
   - Ambil JWT via `POST /auth/login` sekali di awal (JWT default berlaku 15 menit — mungkin perlu refresh untuk run yang panjang).

Contoh setup JWT (bash helper):

```bash
API_URL=https://staging.workpulse.local
EMPLOYEE_JWT=$(curl -sS -X POST "$API_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"loadtest.employee@wp.local","password":"password123"}' \
  | jq -r .accessToken)
HR_JWT=$(curl -sS -X POST "$API_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"loadtest.hr@wp.local","password":"password123"}' \
  | jq -r .accessToken)
export API_URL EMPLOYEE_JWT HR_JWT
```

**⚠ Jangan pernah jalankan load test terhadap production**. Semua scenario mengirim header `X-Load-Test: workpulse-k6` — API men-tag request tersebut di log jadi mudah diaudit, tapi geofence/leave/timesheet **akan** kepakai limit user asli. Selalu pakai env `staging` yang terpisah.

---

## Menjalankan

```bash
cd apps/load-test

# Smoke — wajib SEBELUM run lain.
k6 run scenarios/smoke.js

# Individual scenarios.
k6 run scenarios/clock-in-burst.js
k6 run scenarios/dashboard-read.js
k6 run scenarios/timesheet-export.js

# Baseline mixed — untuk snapshot rilis.
k6 run scenarios/baseline.js
```

Semua threshold latency dan error rate di-hardcode di `lib/config.js` (via env `SLO_*` overrideable). Kalau threshold breach → exit code non-zero — cocok untuk CI:

```yaml
# .github/workflows/load-test.yml (contoh)
- name: k6 baseline
  run: |
    cd apps/load-test
    k6 run --out json=k6-results.json scenarios/baseline.js
- name: upload results
  uses: actions/upload-artifact@v4
  with:
    name: k6-results
    path: apps/load-test/k6-results.json
```

---

## Baseline Numbers (per 2026-08-03, staging)

Target lingkungan: **Hetzner CX32** (2 vCPU, 4 GB RAM), Postgres 16 self-hosted, 1 tenant × 500 seed karyawan, latency ke Frankfurt ~200 ms.

| Metric                    | Target   | Baseline aktual                   |
| ------------------------- | -------- | --------------------------------- |
| Clock-in p95 latency      | ≤ 600 ms | _T.B.M. — jalankan drill pertama_ |
| Clock-in error rate       | ≤ 1%     | _T.B.M._                          |
| Dashboard read p95        | ≤ 300 ms | _T.B.M._                          |
| Export p95 (CSV summary)  | ≤ 5 s    | _T.B.M._                          |
| Export p95 (XLSX detail)  | ≤ 15 s   | _T.B.M._                          |
| Baseline mixed error rate | ≤ 1%     | _T.B.M._                          |

**Update tabel di atas setelah run pertama** di staging. Kalau regresi > 20% dibanding baseline sebelumnya → PR yang menyebabkan wajib block sampai perf-fix / ADR justifikasi.

---

## Capacity Plan

Extrapolasi berdasarkan baseline (akan di-refresh setelah run nyata):

| Ukuran tenant | Karyawan aktif harian | Peak clock-in/s |     RAM VPS | vCPU | Rekomendasi                         |
| ------------- | --------------------: | --------------: | ----------: | ---: | ----------------------------------- |
| XS            |                  ≤ 50 |               5 |        2 GB |    1 | Hetzner CX22                        |
| S             |                 ≤ 200 |              20 |        4 GB |    2 | Hetzner CX32 (baseline pilot)       |
| M             |                ≤ 1000 |             100 |        8 GB |    4 | Hetzner CX42 + Neon managed DB      |
| L             |                ≤ 5000 |             500 | K8s cluster |    — | Multi-replica API + read replica DB |

Formula sizing longgar untuk pilot: 1 GB RAM per 250 karyawan aktif harian + margin 1 GB untuk Postgres cache.

Setelah run baseline nyata, pindahkan angka ini ke `docs/OPS/PERFORMANCE.md` yang lebih formal.
