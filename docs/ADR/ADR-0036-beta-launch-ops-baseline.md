# ADR-0036 — Beta Launch OPS Baseline (Single-VPS Pilot)

- **Status**: Accepted
- **Date**: 2026-08-03
- **Deciders**: Ops lead, Engineering lead
- **Consulted**: SRE reviewer, Product PM
- **Informs**: Milestone 6 (Operational Readiness for GA) — closes OPS-1 through OPS-5 for the Beta / SMB Indonesia pilot scenario

---

## Context

Kami memasuki fase pilot **Beta / Soft Launch** dengan target audience SMB Indonesia (1–10 tenant, ~200–2000 daily active users). Codebase sudah mencapai ~69% dari roadmap product (48 dari 70 fase selesai — attendance core, timesheet, compliance PDP, analytics & reporting), tetapi belum ada procedure operasional yang formal untuk deploy, monitor, backup, load-test, dan respons insiden.

Milestone 6 di `docs/ROADMAP.md` mendefinisikan 7 tugas OPS (OPS-1 … OPS-7) untuk Enterprise GA. Untuk pilot Beta, kami memilih menyelesaikan **subset paling kritikal** (OPS-1 … OPS-5) supaya siap onboard tenant pertama tanpa risiko produksi yang tidak terkontrol. OPS-6 (retention audit) dan OPS-7 (cost instrumentation) di-defer ke post-Beta.

Prinsip yang menuntun keputusan:

1. **Right-size, jangan overbuild.** 1–10 tenant tidak butuh K8s. Single VPS + Docker Compose = 90% value dengan 20% kompleksitas.
2. **Cloud-agnostic artefak.** Playbook + scripts harus berjalan di Hetzner, DigitalOcean, IDCloudHost, atau AWS Lightsail tanpa perubahan.
3. **Recovery-first.** Backup + restore drill lebih penting daripada zero-downtime. Layanan boleh blip 5 detik saat deploy — data tidak boleh hilang.
4. **Ops-friendly untuk tim < 5 orang.** Setiap prosedur harus bisa dijalankan solo oleh 1 on-call, dengan dokumentasi yang cukup dibaca 1 jam.

---

## Decision

Untuk fase Beta, kami menetapkan baseline operasional berikut:

### 1. Deployment topology

- **Single VPS** (Hetzner CX32 setara — 2 vCPU / 4 GB RAM / 40 GB SSD) menjalankan seluruh stack via `docker-compose.prod.yml`.
- **Postgres 16 self-hosted** di container yang sama. Migrasi ke managed (Neon / Supabase) di-defer sampai DB > 5 GB atau tenant > 15.
- **Caddy 2.8** sebagai reverse proxy dengan auto TLS Let's Encrypt. Ports 80/443 (TCP+UDP untuk HTTP/3) satu-satunya yang exposed.
- **Cloudflare R2** untuk attachments (`workpulse-attachments`) dan backup (`workpulse-backups`, terpisah). R2 dipilih karena **zero egress fee** yang menghemat biaya restore/download dibanding S3.
- **Sentry SaaS Free tier** untuk error tracking + 10% performance sampling. Uptime monitoring via **BetterStack Free tier** eksternal.

### 2. Secret management

- Semua secret di `.env.production` (chmod 640, owner root:docker) — **tidak** di git.
- Tanpa Vault / AWS Secrets Manager di Beta. Untuk enterprise GA, migrasi ke Doppler / Vault direncanakan di post-Beta.
- Rotasi: manual, dijadwalkan tahunan (JWT secrets) atau per-event (MFA encryption key hanya jika dicurigai compromised — rotate = re-enroll all users).
- Backup encryption dengan **age** (public-key). Private key **wajib disimpan offline** (password manager + safety box), bukan di VPS.

### 3. Deploy playbook (`scripts/deploy.sh`)

Blue/green-style semi-atomic deploy:

1. Sanity check env + docker daemon.
2. Simpan tag saat ini ke `.last-image-tag` untuk rollback.
3. `docker compose pull` image baru.
4. Jalankan `prisma migrate deploy` di **throwaway container** sebelum swap — kalau migrasi crash, deploy abort tanpa menyentuh service.
5. Recreate api → wait `healthy` (max 3 menit) → recreate web + caddy.
6. Smoke test via public health path.
7. Print image digest untuk audit trail.

Rollback via `scripts/rollback.sh` yang restore tag lama tapi **tidak** revert migrasi otomatis (menghindari data loss dari down-migrations). Kontrak: setiap migrasi wajib backward-compatible dengan release sebelumnya (expand → contract pattern).

Downtime nyata: ~2–5 detik blip saat container recreate. Untuk pilot 1–10 tenant, ini di bawah SLA 99.5% uptime bulanan (memerlukan < 3.6 jam downtime/bulan).

### 4. Backup & restore (`scripts/backup.sh`, `restore.sh`)

- **Sidecar container** (`docker/backup/`) berbasis Alpine + `postgresql16-client` + `rclone` + `age` + `supercronic`.
- **Cron 19:15 UTC** (02:15 WIB) harian — off-peak.
- **Pipeline in-memory**: `pg_dump --format=custom` → `gzip` → `age -r <public>` → `rclone copyto`. Plaintext tidak pernah menyentuh disk.
- **Retention**: 30 hari default (`BACKUP_RETENTION_DAYS`), otomatis prune via `rclone delete --min-age`.
- **RTO / RPO**:
  - RTO: ≤ 2 jam dari deteksi ke recovery (untuk DB pilot < 500 MB).
  - RPO: ≤ 24 jam (backup harian). Untuk RPO lebih ketat, migrasi ke Neon/Supabase yang menyediakan PITR bawaan.
- **Drill kuartalan** wajib di VPS staging terpisah. Log drill dicatat di `RUNBOOK-INDEX.md`.

### 5. Load testing (`apps/load-test/`)

- **k6** dengan 5 skenario:
  - `smoke.js` — 1 VU × 30s (sanity)
  - `clock-in-burst.js` — 250 req/s selama 30s (peak 08:00)
  - `dashboard-read.js` — 40 VU × 3min (HR view)
  - `timesheet-export.js` — 5 VU × 2min (payroll async)
  - `baseline.js` — 30 VU × 5min mixed 70/28/2 (regression tracking)
- SLO thresholds di-encode ke k6 `options.thresholds` — regresi > 20% auto-fail exit code.
- Target lingkungan: **staging**, bukan production. Header `X-Load-Test: workpulse-k6` untuk audit trail.

### 6. Monitoring & SLO (`/api/v1/health/deep` + Sentry + BetterStack)

- **Endpoint baru**: `GET /api/v1/health/deep` (`Public()`, tidak di Swagger publik). Return payload:
  ```json
  {
    "status": "ok" | "degraded" | "down",
    "checks": { "database": {...}, "storage": {...} },
    "workers": { "dataExport": {...}, ... 8 workers ... },
    "version": { "release": "...", "nodeEnv": "..." },
    "uptimeSec": 12345
  }
  ```
  HTTP 200 untuk `ok`, 503 untuk `degraded`/`down`. Probes parallel (DB + S3) dengan timeout bounded 3s per dep.
- **SLO baseline**: p95 read ≤ 300 ms, p95 write ≤ 600 ms, error rate ≤ 1%, uptime ≥ 99.5% bulanan.
- **Sentry alert rules**: 5xx surge (P0), p95 latency degradation (P1), Prisma error spike (P1), event volume weekly (P2).
- **BetterStack**: external monitor `GET /api/v1/health/deep` interval 60s + heartbeat monitor untuk backup (grace 25 jam).

### 7. Incident response

- **6 skenario dokumentasi**: DB unreachable, S3 unreachable, MFA lockout, webhook backlog, breach detected, cron stuck, container OOM, TLS rate-limit, full-site down.
- **Severity model P0/P1/P2/P3** dengan SLA response 15m/1h/4h/1d.
- **On-call rotation mingguan** primary + secondary untuk Beta. PagerDuty/Opsgenie Free tier atau Slack alert routing manual.
- **Post-mortem template** blameless, dalam 5 hari kerja setelah resolve.

---

## Alternatives Considered

### A1. Full Kubernetes migration (rejected)

Migrasi ke K8s (managed EKS / GKE) dipertimbangkan sesuai teks Milestone 6 asli: "Docker compose → Kubernetes migration". Ditolak untuk Beta:

- 1–10 tenant tidak membutuhkan HPA / rolling deploy multi-replica.
- Biaya control plane (~$70/bulan minimum) 3–5× lebih mahal dari VPS single.
- Kompleksitas operasi (RBAC, ingress, secrets ke sealed-secrets, Helm charts) memerlukan skill khusus yang belum ada di tim kecil.
- Dipertahankan di roadmap untuk Enterprise GA saat tenant > 15 atau perlu multi-region.

### A2. Managed Postgres (Neon / Supabase) daripada self-hosted (rejected untuk Beta)

Managed DB memberikan PITR bawaan (RPO menit alih-alih hari) tapi:

- Biaya $19–29/bulan tambahan.
- Latency network ke VPS lebih tinggi kalau region tidak match (Neon Frankfurt vs VPS Jakarta).
- Menambah 1 vendor lock-in.

Kami akan re-evaluasi saat DB > 5 GB atau saat tenant compliance require RPO < 1 jam.

### A3. AWS ECS / Fargate (rejected)

Deployment orchestrator managed dari AWS. Trade-off mirip K8s: 2–3× biaya, kompleksitas naik, latency ke ID region tidak optimal (Singapore ap-southeast-1). Lebih cocok untuk tim yang sudah standar di AWS.

### A4. GitOps (Argo CD / Flux) di VPS (rejected)

Overkill untuk 2 image (api + web). Tetap simpan `.last-image-tag` file + `deploy.sh` yang idempotent. GitOps akan masuk kalau microservice > 5.

### A5. Vault untuk secrets (deferred)

Untuk Beta cukup `.env.production` di server. Vault (self-hosted atau Doppler) direncanakan saat tenant enterprise pertama masuk yang butuh audit trail secret access.

### A6. Managed backup service (rejected)

Ada opsi seperti Barman, pgbackrest managed. Ditolak karena overkill untuk pilot. Sidecar + rclone + age memberikan kontrol penuh dengan overhead < 100 MB RAM.

---

## Consequences

### Positive

- Ops team baru bisa onboarding dalam 1 hari (baca 6 dokumen di `docs/OPS/`).
- Deploy time: pull → migrate → recreate → smoke test ≈ **3–5 menit** untuk 2 container.
- Backup cost: ~$0.15/GB/bulan R2 + $0/egress → **< $2/bulan** untuk pilot ukuran S.
- Total VPS + observability + backup cost untuk pilot: **~$12–18/bulan** (Hetzner + Cloudflare + Sentry Free + BetterStack Free).
- Baseline SLO measurable + threshold enforceable di CI.
- Full DR playbook dokumentatif — worst-case tenant tidak lebih dari 2 jam offline + RPO 24 jam.
- Semua secret bisa di-rotate individual tanpa full stack restart (kecuali `MFA_SECRET_ENCRYPTION_KEY` yang memerlukan re-enroll).

### Negative

- **Blip 2–5 detik** saat deploy karena Compose stop-then-start satu container. Bukan zero-downtime.
- **RPO 24 jam** — data 24 jam terakhir hilang saat DR total. Tidak cocok untuk tenant yang butuh RPO < 1 jam.
- **Single point of failure**: satu VPS. Kalau provider outage regional, layanan down sampai VPS baru provisioned + restore selesai (RTO ~2 jam).
- **Ops manual load**: on-call harus tahu Docker + Postgres + rclone. Skill set tidak umum.
- **Rate limit Let's Encrypt** (5 issuance / hostname / minggu) berisiko kalau volume `caddy_data` sengaja/tidak dihapus. Mitigasi: dokumentasi + backup volume di setup awal.
- **k6 baseline belum dijalankan** — semua threshold di-encode tapi angka aktual masih T.B.M. sampai run pertama post-deploy staging.

### Neutral

- Watchtower disediakan sebagai profile opsional (`--profile autoupdate`) untuk tim yang lebih suka push-to-deploy. Default off supaya deployment log tetap eksplisit.
- Test coverage bertambah 7 unit test untuk `HealthDeepService`, mencapai total 994 unit + 37 E2E.

---

## Rollback Plan

Ke depan, kalau baseline OPS ini terbukti tidak memadai (misalnya downtime pilot pertama > 4 jam):

1. **Untuk deploy strategy**: fallback ke `docker compose down && up -d` sederhana. Bukan zero-downtime tapi eliminasi kompleksitas `scripts/deploy.sh` yang sensitif ke health check.
2. **Untuk backup**: fallback ke `pg_dump | gzip > /backup/*.gz` di volume terpisah + rsync manual ke S3. Kehilangan enkripsi at-rest tapi cepat setup.
3. **Untuk monitoring**: cukup Sentry + `curl` cron di Zapier / Make.com kalau BetterStack terlalu ribet setup.
4. **Untuk incident response**: kalau P0 kedua terjadi dalam 30 hari → escalate ke opsi K8s + managed DB (memicu A1 + A2 di atas).

Kunci: dokumentasi ini adalah **living document**. Setelah tenant pilot ke-3, re-evaluasi seluruh dokumen dengan lens "apa yang sudah kepakai vs tidak?".

---

## Files

Semua artefak baru untuk ADR ini:

**Compose + Docker infrastructure**:

- `docker-compose.prod.yml` — hardened production stack
- `docker/caddy/Caddyfile` — reverse proxy dengan auto TLS
- `docker/backup/Dockerfile` — sidecar image (Alpine + pg-client + rclone + age + supercronic)
- `docker/backup/entrypoint.sh` — cron loop wrapper
- `docker/backup/run-backup.sh` — single backup run pipeline
- `.env.production.example` — dokumentasi seluruh env vars produksi

**Ops scripts**:

- `scripts/lib/ops-common.sh` — shared bash helpers
- `scripts/deploy.sh` — blue/green deploy playbook
- `scripts/rollback.sh` — image tag rollback
- `scripts/health-check.sh` — post-deploy probe
- `scripts/backup.sh` — ad-hoc backup runner
- `scripts/list-backups.sh` — inventory
- `scripts/restore.sh` — restore drill

**API changes**:

- `apps/api/src/health/health-deep.service.ts` — deep dependency probe (7 unit tests)
- `apps/api/src/health/health-deep.service.spec.ts`
- `apps/api/src/health/health.controller.ts` — added `GET /health/deep`
- `apps/api/src/health/health.module.ts` — wired `StorageModule` + `HealthDeepService`
- `apps/api/src/storage/storage.provider.ts` — added `healthCheck()` to interface
- `apps/api/src/storage/s3-storage.provider.ts` — implemented `HeadBucket` probe with 3s abort timeout

**Load test suite** (`apps/load-test/`):

- `package.json` + `README.md`
- `lib/config.js` + `lib/auth.js`
- `scenarios/smoke.js` + `clock-in-burst.js` + `dashboard-read.js` + `timesheet-export.js` + `baseline.js`

**Documentation** (`docs/OPS/`):

- `DEPLOYMENT.md` — playbook lengkap dengan pre-flight checklist
- `BACKUP-RESTORE.md` — pipeline + RTO/RPO commitment + drill playbook
- `PERFORMANCE.md` — SLO targets + capacity plan + tuning guide
- `MONITORING.md` — Sentry setup + BetterStack setup + alert rules
- `INCIDENT-RESPONSE.md` — 9 skenario dengan diagnostic + tindakan
- `ON-CALL.md` — rotasi + communication template + post-mortem template
- `RUNBOOK-INDEX.md` — TOC + cheat sheet + drill log

Total: 3 files kode + 7 dokumen + 5 skenario k6 = **Beta pilot siap onboard tenant pertama**.
