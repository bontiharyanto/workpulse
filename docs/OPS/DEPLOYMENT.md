# Workpulse — Production Deployment Playbook (Beta / Single-VPS)

Status: **canonical for pilot SMB Indonesia tenants**.
Terakhir divalidasi: 2026-08-03.

---

## Ringkasan Topologi

Satu VPS menjalankan seluruh stack lewat Docker Compose:

```
                            ┌───────────────────────────────┐
                            │  Cloudflare DNS + WAF (opsional) │
                            └─────────────┬──────────────────┘
                                          │
                     ┌────────────────────┼────────────────────┐
                     │                    │                    │
                 :443/tcp             :443/udp (HTTP/3)     :80/tcp
                     │                    │                    │
                     └────────────────────┼──── redirect →─────┘
                                          │
                                    ┌─────▼─────┐
                                    │  Caddy    │  auto TLS (Let's Encrypt)
                                    │  reverse  │  edge network
                                    │  proxy    │
                                    └──┬──────┬─┘
                                       │      │
                               ┌───────▼─┐  ┌─▼────────┐
                               │ web:3000│  │ api:4000 │
                               │ Next.js │  │ NestJS   │
                               └─────────┘  └────┬─────┘
                                                 │ internal net (SCRAM auth)
                                          ┌──────▼──────┐
                                          │ postgres:16  │
                                          └──────┬───────┘
                                                 │
                                          ┌──────▼──────┐
                                          │  backup     │ ── nightly →  Cloudflare R2
                                          │  sidecar    │      (age-encrypted)
                                          └─────────────┘
```

Semua secret hidup di `.env.production` (chmod 640). Tidak ada plaintext di git.

---

## 1. Prasyarat Host (VPS)

**Sizing minimum** (untuk 1–10 tenant, ~500 daily active):

| Sumber daya | Minimum                                 |
| ----------- | --------------------------------------- |
| vCPU        | 2                                       |
| RAM         | 4 GB                                    |
| Disk        | 40 GB SSD                               |
| Bandwidth   | 4 TB/bulan                              |
| OS          | Ubuntu 22.04 / 24.04 LTS atau Debian 12 |

Rekomendasi provider: **Hetzner CX32** (~~€6/bulan) atau **DigitalOcean 4 GB Droplet** (~~$24/bulan) atau **IDCloudHost Small** (untuk data sovereignty ID).

Untuk >10 tenant atau >2 GB DB size: upgrade RAM ke 8 GB, atau migrasi Postgres ke Neon/Supabase.

**Software prasyarat**:

```bash
sudo apt update && sudo apt install -y \
  ca-certificates curl gnupg ufw fail2ban jq

# Docker Engine 27+ (bawaan Ubuntu 22.04 sudah cukup baru).
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# UFW — hanya buka HTTP/HTTPS + SSH. Docker akan bind ke Caddy saja.
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp   # HTTP/3
sudo ufw enable
```

---

## 2. Persiapan Domain + DNS

Sebelum deploy pertama:

1. Beli / dedikasikan **dua** domain / subdomain:
   - `app.example.com` → frontend Next.js
   - `api.example.com` → backend NestJS
2. Point A record kedua-nya ke IP publik VPS.
3. Verifikasi propagasi: `dig +short app.example.com` harus balik IP VPS.

TLS di-issue otomatis oleh Caddy saat container pertama kali up. Rate limit Let's Encrypt: 5 issuance per hostname per minggu — **jangan menghapus volume `caddy_data` sembarangan**.

---

## 3. First-time Provisioning

### 3.1. Clone + isi env

```bash
git clone git@github.com:workpulse/workpulse.git /opt/workpulse
cd /opt/workpulse
cp .env.production.example .env.production
chmod 640 .env.production
```

Edit `.env.production` dan **ROTATE** setiap value bertanda `CHANGE_ME`:

| Env                                | Cara generate                                             |
| ---------------------------------- | --------------------------------------------------------- |
| `POSTGRES_PASSWORD`                | `openssl rand -base64 32`                                 |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | `openssl rand -base64 48`                                 |
| `MFA_SECRET_ENCRYPTION_KEY`        | `openssl rand -base64 32`                                 |
| `TIMESHEET_EXPORT_SIGNING_SECRET`  | `openssl rand -base64 32`                                 |
| `S3_*` (attachments)               | Cloudflare R2 dashboard → Manage R2 API Tokens            |
| `BACKUP_S3_*`                      | Bucket / token TERPISAH dari attachments                  |
| `BACKUP_AGE_RECIPIENT`             | `age-keygen -o backup-key.txt` → salin nilai `public key` |
| `SMTP_*`                           | SES / SendGrid / Mailgun account                          |

**PENTING**: file `backup-key.txt` (yang berisi private key `AGE-SECRET-KEY-…`) **JANGAN** disimpan di VPS. Simpan di password manager tim dan/atau vault fisik. Tanpa private key, backup tidak bisa di-decrypt saat restore.

### 3.2. Bootstrap Postgres init

Migrasi Prisma otomatis jalan saat container `api` start (`prisma migrate deploy` di CMD Dockerfile). Yang perlu disiapkan hanya folder init:

```bash
ls docker/postgres/init/   # sudah ada dari repo — biarkan kosong kalau tidak ada custom init.
```

### 3.3. First launch

```bash
# Build image backup lokal + pull image api/web dari registry.
docker compose -f docker-compose.prod.yml --env-file .env.production build backup
docker compose -f docker-compose.prod.yml --env-file .env.production pull

# Boot semuanya.
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# Tunggu ~1 menit — Postgres init, api jalan migrate deploy, Caddy request cert Let's Encrypt.
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Verifikasi:

```bash
./scripts/health-check.sh   # deep health probe via api.example.com

curl -I https://app.example.com/           # 200 + valid TLS
curl -I https://api.example.com/api/v1/health
```

### 3.4. Seed super admin awal

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec api \
  node dist/prisma/seed.js --email you@example.com --password "<one-time-password>"
```

Login → langsung enroll MFA → reset password personal.

---

## 4. Deploy Update (blue-green style)

Ada di `scripts/deploy.sh`. Alur singkat:

```bash
cd /opt/workpulse
git fetch --tags
git checkout v2026.09.01     # tag rilis
IMAGE_TAG=v2026.09.01 ./scripts/deploy.sh
```

Script otomatis:

1. Verifikasi env + docker daemon.
2. Simpan tag saat ini ke `.last-image-tag` (untuk rollback).
3. `docker compose pull` image baru.
4. Jalankan `prisma migrate deploy` di throwaway container **sebelum** swap.
5. Recreate `api` → tunggu healthy → recreate `web` + `caddy`.
6. Smoke test `/api/v1/health` via public domain.
7. Cetak digest untuk audit trail — masukkan ke deploy log tim.

**Skip migration check** (misal migrasi sudah dijalankan manual dari operator jump host):

```bash
IMAGE_TAG=v2026.09.01 SKIP_MIGRATION_CHECK=1 ./scripts/deploy.sh
```

---

## 5. Rollback

```bash
./scripts/rollback.sh                     # rollback ke tag yang tersimpan di .last-image-tag
FORCE_TAG=v2026.08.15 ./scripts/rollback.sh
```

**⚠ Migrasi Prisma tidak otomatis di-revert**. Kalau schema baru tidak backward-compatible dengan image lama, rollback akan crash-loop `api`. Karena itu:

- Setiap migrasi **wajib** backward-compatible dengan release sebelumnya (expand → contract pattern: tambah kolom nullable dulu, deploy code baru, deploy migrasi contract di rilis berikutnya).
- Untuk migrasi destruktif yang harus segera live, siapkan `psql` rollback script manual di PR yang sama dan dokumentasikan di rilis notes.

---

## 6. Zero-downtime Considerations

Deploy playbook di atas menyisakan **~2–5 detik blip** saat container `api` di-recreate (Compose stop-then-start). Untuk pilot ini oke — 99.9% uptime = 8.76 jam downtime/tahun; blip 5 detik × 4 deploy/bulan = ~4 menit/tahun. Kalau butuh benar-benar zero-downtime:

- Jalankan **dua replica** `api` di belakang Caddy dengan `lb_policy round_robin`.
- Deploy dengan `docker compose up -d --no-deps --scale api=2` dan cycle satu per satu.
- Estimasi effort untuk migrasi ke topologi 2-replica: 1–2 hari + tambahan 1 GB RAM di host.

Simpan untuk Milestone 2 setelah pilot stabil.

---

## 7. Watchtower (opsional)

Kalau tim kecil dan lebih suka "push tag → deploy otomatis":

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  --profile autoupdate up -d
```

Watchtower akan poll GHCR setiap 5 menit, pull tag baru, dan rolling-restart container yang punya label `com.centurylinklabs.watchtower.enable=true`. Untuk pilot enterprise **jangan aktifkan** — kami mau kontrol eksplisit lewat `deploy.sh` supaya deployment log kejaga.

---

## 8. Log & Observability Pos Deploy

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f caddy
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f backup
```

Sentry menerima error 5xx otomatis (lihat `SENTRY_DSN`). Untuk SLO dashboard, ikuti `docs/OPS/MONITORING.md`.

---

## 9. Deploy Log Template

Tempel di Notion / Google Doc tim setiap kali deploy:

```
Deploy: v2026.09.01
When:   2026-09-01T02:15Z (09:15 WIB)
Who:    <PIC>
Approval:  <PR link>  / <migration review link>
Migration count:  <n>  (breaking? YES/NO)
Health after deploy:
  - GET /api/v1/health         -> 200 OK
  - GET /api/v1/health/deep    -> status=ok  ({"db":"up","s3":"up",...})
Digest api:  ghcr.io/workpulse/api@sha256:...
Digest web:  ghcr.io/workpulse/web@sha256:...
Notes: <e.g. "MFA_ENFORCE_HR_ADMIN flip ke true — semua HR sudah enroll">
```

---

## 10. Checklist "Go-Live" untuk Pilot Tenant

Wajib centang **semua** sebelum onboard tenant produksi pertama:

- [ ] DNS A record `app.` + `api.` propagated, TTL ≤ 300 s.
- [ ] Semua `CHANGE_ME` di `.env.production` diganti (grep untuk verifikasi).
- [ ] `age-keygen` sudah dijalankan; private key **disimpan offline** (password manager tim).
- [ ] TLS Let's Encrypt aktif (`curl -I https://app.example.com` → 200 + cert valid).
- [ ] Super admin dibuat, MFA sudah enroll.
- [ ] Backup pertama berhasil (`./scripts/list-backups.sh` menampilkan ≥1 objek).
- [ ] Restore drill sukses di VPS terpisah (staging) — lihat `BACKUP-RESTORE.md` §4.
- [ ] Sentry DSN terisi, event pertama terlihat di dashboard Sentry.
- [ ] Uptime monitor eksternal (BetterStack / UptimeRobot) monitoring `/caddy-health`.
- [ ] `docs/OPS/INCIDENT-RESPONSE.md` sudah dibaca oleh minimum 2 orang on-call.
- [ ] Runbook rollback dijalankan sekali di staging (bukan sekedar dibaca).

Kalau ada checkbox belum tercentang → **jangan** onboard tenant. Tunda 24 jam untuk mengejar.
