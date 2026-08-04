# Workpulse — Monitoring & SLO Runbook

Panduan observability untuk pilot SMB Indonesia. Setup ini "cukup baik" untuk 1–10 tenant: 90% dari value dengan 20% dari kompleksitas full Grafana/Prometheus stack.

---

## 1. Stack Observability

| Kapabilitas | Tool | Cost | Setup |
|---|---|---:|---|
| Error tracking (5xx, JS crash, unhandled promise) | Sentry (SaaS Free tier — 5k events/bulan) | Free | Sudah wired, tinggal set `SENTRY_DSN` |
| Performance / latency tracing | Sentry Performance | Free (10% sampling) | `SENTRY_TRACES_SAMPLE_RATE=0.1` di prod |
| Structured logs | pino → stdout → Docker json-file driver | Free | Bawaan |
| Log aggregation (opsional Phase 2) | Loki / Grafana Cloud / Datadog | Opsional | Kirim json log via Vector agent |
| Uptime monitoring (external ping) | BetterStack (Free 10 monitor) atau UptimeRobot | Free | Manual setup, lihat §5 |
| Dependency health | `/api/v1/health/deep` (baru di Fase Beta) | — | Live sekarang |

Untuk pilot **tidak wajib** Grafana Cloud / Prometheus scraping. Sentry sudah menyediakan p50/p95/p99 per endpoint. Dashboard SLO custom bisa ditunda ke Milestone Enterprise GA.

---

## 2. Endpoints & Signal Sources

### 2.1. `GET /api/v1/health` — shallow

Dipakai oleh:
- Docker `HEALTHCHECK` di Dockerfile.
- Caddy internal liveness (`/caddy-health`).
- Load balancer / autoscaler kalau nanti dimasukkan.

Selalu balikin 200 kalau proses masih hidup. **Bukan** untuk external alerting.

### 2.2. `GET /api/v1/health/deep` — dependency probe

Payload:
```json
{
  "status": "ok" | "degraded" | "down",
  "timestamp": "2026-08-03T12:34:56.000Z",
  "uptimeSec": 12345,
  "version": { "nodeEnv": "production", "release": "v2026.08.03" },
  "checks": {
    "database": { "status": "up", "latencyMs": 3 },
    "storage":  { "status": "up", "latencyMs": 42 }
  },
  "workers": {
    "dataExport":         { "enabled": true },
    "dataErasure":        { "enabled": true },
    "retention":          { "enabled": true },
    "webhook":            { "enabled": true },
    "timesheetScheduler": { "enabled": true },
    "analyticsSnapshot":  { "enabled": true },
    "reportScheduler":    { "enabled": true },
    "breachReminder":     { "enabled": true }
  }
}
```

Aturan HTTP status:

| Overall status | HTTP | Meaning | On-call action |
|---|---:|---|---|
| `ok` | 200 | Semua dep sehat | — |
| `degraded` | 503 | Storage unreachable — attachment upload fail, tapi core attendance masih jalan | Investigate storage vendor. Update stakeholder kalau > 15 menit. |
| `down` | 503 | Database unreachable — semua tulis gagal | **PAGE ON-CALL SEKARANG.** Ikuti `docs/OPS/INCIDENT-RESPONSE.md` §"Database unreachable". |

External uptime monitor **wajib** point ke `/api/v1/health/deep` (bukan `/health`). Interval 60s cocok untuk Free tier.

### 2.3. Sentry Signals

Otomatis di-capture dari `apps/api/src/instrument.ts`:
- Unhandled 5xx exceptions.
- Slow transactions > `SENTRY_TRACES_SAMPLE_RATE` sample (default 10% di prod).
- Manual `Sentry.captureException(err)` di service layer (spot-check dulu — banyak service masih rely on auto-instrument).

**4xx business validation errors DROP-ED** — lihat filter `beforeSend` di `instrument.ts`. Ini disengaja: `BadRequestException("insufficient balance")` bukan bug.

---

## 3. SLO Targets

Baseline SLO untuk pilot Beta (dipublikasikan ke tenant dalam SLA):

| Metric | Target | Threshold alert |
|---|---:|---|
| Uptime bulanan | **≥ 99.5%** | 1 alert setelah > 6 menit downtime/hari |
| p95 read latency | **≤ 300 ms** | Sentry alert kalau p95 > 500 ms selama 10 menit |
| p95 write latency | **≤ 600 ms** | Sentry alert kalau p95 > 1000 ms selama 10 menit |
| 5xx error rate | **≤ 0.1%** | Sentry alert kalau > 0.5% selama 5 menit |
| Backup success (H+1) | **100%** untuk lookback 7 hari | Heartbeat monitor kalau > 25 jam tanpa heartbeat |
| MFA enroll rate (HR/Admin) | **100%** | Cron internal (tidak eksternal — HR akan bugbot user) |

Kalau breach: file P1 ticket, notify tenant primary contact dalam 30 menit, publikasi post-mortem dalam 5 hari kerja.

---

## 4. Sentry Configuration (production)

### 4.1. Project setup

1. Create project di Sentry: **`workpulse-api-prod`** (platform: Node/NestJS).
2. Copy DSN ke `.env.production`:
   ```env
   SENTRY_DSN=https://xxx@oxxx.ingest.sentry.io/xxxx
   SENTRY_ENVIRONMENT=production
   SENTRY_RELEASE=v2026.08.03        # bump tiap deploy
   SENTRY_TRACES_SAMPLE_RATE=0.1
   ```
3. Ulangi untuk `workpulse-web-prod` (platform: Next.js) — belum wired di kode, TODO Fase Beta+1.

### 4.2. Release tracking

Setiap deploy, script `deploy.sh` seharusnya:

```bash
# Optional — bikin release entry di Sentry supaya error di-attach ke commit range
SENTRY_AUTH_TOKEN=... sentry-cli releases new "$IMAGE_TAG"
SENTRY_AUTH_TOKEN=... sentry-cli releases set-commits "$IMAGE_TAG" --auto
```

Untuk Beta cukup manual — jangan tambah CI step baru sampai tim > 3 orang.

### 4.3. Alert rules

Setup di Sentry UI (Projects → Alerts → Create Alert):

| Nama | Condition | Actions |
|---|---|---|
| **[P0] 5xx surge** | `event.level:error` count > 20 dalam 5 menit | Slack #ops + PagerDuty on-call |
| **[P1] p95 latency degradation** | `transaction.duration:p95(all)` > 1000 ms selama 15 menit | Slack #ops |
| **[P1] Prisma error spike** | `error.type:PrismaClientKnownRequestError` count > 10 dalam 10 menit | Slack #ops |
| **[P2] Sentry event volume weekly** | Event count > 4k dalam 7 hari (mendekati Free quota) | Email admin |

---

## 5. External Uptime Monitor (BetterStack)

1. Sign up di [betterstack.com](https://betterstack.com) — Free tier: 10 monitor, 3-menit interval.
2. Create monitor:
   - **URL**: `https://api.example.com/api/v1/health/deep`
   - **Method**: GET
   - **Interval**: 60s (Free minimum 3-menit — upgrade Basic $29/mo untuk 60s)
   - **Timeout**: 15s
   - **Expected status**: 200
   - **Expected body contains**: `"status":"ok"`
3. Alert policy:
   - Level 1: Slack #ops after 2 failed checks (2 menit).
   - Level 2: SMS/phone call primary on-call after 5 failed checks (5 menit).
4. Create heartbeat monitor untuk backup:
   - **Expected interval**: 25 hours
   - **Grace period**: 1 hour
   - Assign URL to `HEARTBEAT_URL` env di `docker/backup/run-backup.sh` (lihat `docs/OPS/BACKUP-RESTORE.md` §6).
5. Public status page: **opsional** — bikin subdomain `status.workpulse.example.com` yang embed BetterStack status widget.

---

## 6. Log Aggregation (opsional / phase 2)

Untuk pilot, `docker compose logs -f api` sudah cukup. Kalau tim mulai butuh search cepat:

**Opsi murah**: Grafana Cloud Free tier (50 GB logs/bulan, retention 14 hari).

Setup ringkas:
```bash
# Install Grafana Alloy (bekas "grafana-agent") sebagai systemd service di VPS.
# Alloy scrape docker container logs + kirim ke Grafana Cloud.
sudo apt install alloy
# Isi /etc/alloy/config.alloy dengan konfigurasi loki.write:
```

Contoh config (`/etc/alloy/config.alloy`):

```alloy
loki.write "grafana_cloud" {
  endpoint {
    url = "https://logs-prod-us-central1.grafana.net/loki/api/v1/push"
    basic_auth {
      username = "1234567"
      password = "eyJrIjoi..."  // read/write API key
    }
  }
}

discovery.docker "local" {
  host = "unix:///var/run/docker.sock"
}

loki.source.docker "logs" {
  host       = "unix:///var/run/docker.sock"
  targets    = discovery.docker.local.targets
  forward_to = [loki.write.grafana_cloud.receiver]
  labels     = { app = "workpulse" }
}
```

Tunggu sampai tim butuh — jangan install sebelum ada pain nyata.

---

## 7. Dashboard KPI (di dalam Workpulse sendiri)

Selain infrastruktur, produk sudah punya **Executive KPI Dashboard** (Fase 33a) yang membantu ops memantau *business health*:

- `/admin/analytics/dashboard` — attendance on-time rate, late count, headcount active.
- `/admin/reports/scheduled` — status delivery report email otomatis.
- `/admin/security/breaches` — countdown deadline 72 jam per incident.

Kalau salah satu dashboard business menunjukkan angka aneh (mis. attendance rate drop 30% tiba-tiba), itu adalah signal untuk ops verify — mungkin ada bug attendance clock-in atau timezone regression.

---

## 8. Ringkasan yang On-call Perlu Ingat

- **Panic button**: `curl https://api.example.com/api/v1/health/deep | jq .status` — kalau `"down"` → follow `docs/OPS/INCIDENT-RESPONSE.md`.
- **Log**: `ssh <vps> && docker compose logs -f api caddy`.
- **Sentry**: [sentry.io/organizations/workpulse](https://sentry.io) → `workpulse-api-prod`.
- **BetterStack**: [uptime.betterstack.com](https://uptime.betterstack.com).
- **Backup status**: `docker compose exec backup cat /var/lib/workpulse-backup/last-success`.

Tidak lebih dari 5 tools untuk dihafal. Anything more = jangan tambah dulu.
