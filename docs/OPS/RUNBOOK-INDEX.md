# Workpulse — Ops Runbook Index

Peta cepat dokumen ops. Kalau ragu, mulai dari sini.

---

## Dokumentasi Utama

| Dokumen                                          | Kapan dibaca                                                    | Owner           |
| ------------------------------------------------ | --------------------------------------------------------------- | --------------- |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md)               | Setup pertama, setiap release, rollback                         | Ops lead        |
| [`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md)       | Drill kuartalan, DR, rotasi key                                 | Ops + DBA       |
| [`PERFORMANCE.md`](./PERFORMANCE.md)             | Sebelum release mayor, capacity planning                        | Ops + Eng       |
| [`MONITORING.md`](./MONITORING.md)               | Setup awal + tiap onboard on-call                               | Ops             |
| [`INCIDENT-RESPONSE.md`](./INCIDENT-RESPONSE.md) | Saat pager berbunyi                                             | On-call         |
| [`ON-CALL.md`](./ON-CALL.md)                     | Setiap awal shift + review bulanan                              | Semua on-call   |
| [`CICD.md`](./CICD.md)                           | Sebelum cutting release, saat pipeline merah, rotasi secrets CI | Release manager |
| [`MAP-BOOTSTRAP.md`](./MAP-BOOTSTRAP.md)         | Setup pertama map self-hosted, refresh archive bulanan          | Ops lead        |

---

## Cheat Sheet Command

### Deploy

```bash
IMAGE_TAG=v2026.09.01 ./scripts/deploy.sh
```

### Rollback

```bash
./scripts/rollback.sh
FORCE_TAG=v2026.08.15 ./scripts/rollback.sh
```

### Health probe

```bash
./scripts/health-check.sh
curl -sS https://api.example.com/api/v1/health/deep | jq .
```

### Backup

```bash
./scripts/backup.sh                                     # ad-hoc
TAG=pre-migration-v20260901 ./scripts/backup.sh         # tagged
./scripts/list-backups.sh                               # inventory
NEWEST=5 ./scripts/list-backups.sh
```

### Restore drill

```bash
AGE_IDENTITY_FILE=/root/backup-key.txt \
  BACKUP_OBJECT=workpulse-workpulse-20260803T191500Z.dump.gz.age \
  ./scripts/restore.sh
```

### Load test

```bash
cd apps/load-test
API_URL=https://staging.workpulse.local EMPLOYEE_JWT=... HR_JWT=... k6 run scenarios/baseline.js
```

### Logs

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f caddy
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f postgres
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f backup
```

### Postgres shell

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec postgres \
  psql -U workpulse -d workpulse
```

---

## Drill Log

Catat setiap drill yang dijalankan di sini. Kalau > 90 hari sejak drill terakhir → jadwalkan segera.

| Tanggal | Drill                    | Duration | PIC | Hasil | Notes                                    |
| ------- | ------------------------ | -------: | --- | ----- | ---------------------------------------- |
| —       | Restore drill (staging)  |        — | —   | —     | Belum pernah — schedule sebelum go-live! |
| —       | Rollback drill (staging) |        — | —   | —     | Belum pernah                             |
| —       | Full-site DR drill       |        — | —   | —     | Belum pernah                             |

Update tabel ini setelah setiap drill.

---

## Insiden Terdaftar

Lihat `docs/OPS/incidents/` (folder dibuat setelah incident pertama). Naming: `YYYY-MM-DD-<slug>.md`.

---

## External Links

- Sentry (prod): [sentry.io/organizations/workpulse](https://sentry.io) → project `workpulse-api-prod`
- BetterStack: [uptime.betterstack.com](https://uptime.betterstack.com)
- Cloudflare R2 dashboard: [dash.cloudflare.com](https://dash.cloudflare.com) → R2 → workpulse-backups + workpulse-attachments
- GHCR (image registry): [github.com/orgs/workpulse/packages](https://github.com/orgs/workpulse/packages)
- Docs kanonik: `docs/ARCHITECTURE.md` + `docs/WORKFLOW.md`

---

## Kalau Buntu

1. Baca dokumen relevan di daftar atas.
2. `grep -rn "<keyword>" docs/` — dokumen biasanya menyebutkan feature dengan penuh.
3. `git log --oneline -- <file>` untuk cari komit yang menyentuh feature terkait.
4. Kalau tetap buntu → escalate ke secondary on-call → engineering lead.
5. Kalau P0 belum resolve 2 jam → CTO / founder page.

**Selalu** dokumentasikan sesuatu yang kamu pelajari, tambahkan ke docs ini via PR.
