# Workpulse — Incident Response Runbook

Cara bertindak saat produksi rusak. Baca sekali sekarang, drill sekali di staging, dan simpan bookmark URL ini.

**Definisi severity** dan escalation ada di `docs/OPS/ON-CALL.md`.

---

## Alur Umum (setiap incident)

```
    ┌──────────────────┐
    │ 1. DETECT        │  Sentry / BetterStack / user report / /health/deep 503
    └────────┬─────────┘
             ▼
    ┌──────────────────┐
    │ 2. TRIAGE (10m)  │  Severity? Blast radius? Baca dashboard.
    └────────┬─────────┘
             ▼
    ┌──────────────────┐
    │ 3. STABILIZE     │  Rollback ATAU mitigate. Prioritas: stop the bleeding.
    └────────┬─────────┘
             ▼
    ┌──────────────────┐
    │ 4. COMMUNICATE   │  Status page / #ops / tenant primary contact.
    └────────┬─────────┘
             ▼
    ┌──────────────────┐
    │ 5. RESOLVE       │  Verify metrics healed, monitor 30 menit tambahan.
    └────────┬─────────┘
             ▼
    ┌──────────────────┐
    │ 6. POST-MORTEM   │  Blameless, timeline, action items. < 5 hari kerja.
    └──────────────────┘
```

Aturan emas:

1. **Kabari sebelum menyelidiki.** 2 baris di #ops sekarang > laporan lengkap 30 menit kemudian.
2. **Rollback dulu kalau ambigu.** Rollback ≠ kalah — restore stability, investigate offline.
3. **Ubah satu variabel.** Kalau memasang restart + tuning + patch bersamaan, kita tidak akan tahu mana yang berhasil.
4. **Screenshot / log dump kalau ragu keputusan destruktif.** Anda bakal butuhkan itu di post-mortem.

---

## Skenario 1 — Database Unreachable

**Gejala**

- `/api/v1/health/deep` → `"status":"down"`, `checks.database.status = "down"`.
- 5xx surge di Sentry (semua endpoint yang menulis).
- `docker compose logs api` menampilkan `PrismaClientInitializationError` atau `ECONNREFUSED`.

**Diagnosis (3 menit)**

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps postgres
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail 100 postgres

# Disk penuh?
df -h /var/lib/docker
docker compose -f docker-compose.prod.yml --env-file .env.production exec postgres \
  df -h /var/lib/postgresql/data

# Memory pressure?
free -m
docker stats --no-stream

# Postgres masih responsive?
docker compose -f docker-compose.prod.yml --env-file .env.production exec postgres \
  psql -U workpulse -c "SELECT COUNT(*) FROM pg_stat_activity;"
```

**Kemungkinan penyebab & tindakan**

| Penyebab                                          | Tindakan                                                                                                                                                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container postgres crash                          | `docker compose restart postgres` + tunggu 30 detik + retry `/health/deep`                                                                                                                                                                                                   |
| Disk penuh (WAL / logs)                           | Trim: `docker compose exec postgres psql -U workpulse -c "CHECKPOINT; VACUUM (FULL, ANALYZE);"` (perhatian: FULL akan lock write). Kalau safe, restart postgres setelah checkpoint. Tambah disk kalau > 80%.                                                                 |
| OOM killed                                        | Lihat `dmesg \| grep -i "oom-kill"` di host. Turunkan `shared_buffers` sementara atau upgrade VPS RAM.                                                                                                                                                                       |
| Connection pool exhausted (100 connections limit) | `docker compose exec postgres psql -U workpulse -c "SELECT COUNT(*), usename FROM pg_stat_activity GROUP BY usename;"`. Kill idle connections: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='idle' AND state_change < now() - interval '10 minutes';` |
| Corrupt WAL / crash recovery loop                 | Restore terbaru dari backup — ikuti `docs/OPS/BACKUP-RESTORE.md` §5 (Disaster Recovery).                                                                                                                                                                                     |

**Kalau DB tidak recovery dalam 15 menit** → deklarasi **P0**, mulai DR restore.

---

## Skenario 2 — Storage (S3 / R2) Unreachable

**Gejala**

- `/api/v1/health/deep` → `"status":"degraded"`, `checks.storage.status = "down"`.
- Upload attachment (leave dokter note, permit file) gagal dengan 500.
- Timesheet export shared download fail — payload persisted lokal tapi share link mati.
- **Core attendance tetap jalan** karena tidak butuh S3.

**Diagnosis**

```bash
# Bucket credential valid?
curl -sS "$S3_ENDPOINT" -X GET \
  -H "Authorization: AWS4-HMAC-SHA256 ..."  # gampangnya via rclone di backup container:
docker compose exec backup rclone lsd dest:

# DNS / connectivity?
docker compose exec api sh -c "wget -qO- --timeout=5 https://$(echo $S3_ENDPOINT | cut -d/ -f3)"
```

**Tindakan**

| Penyebab                      | Tindakan                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare R2 outage regional | Cek [status.cloudflare.com](https://www.cloudflarestatus.com). Kalau confirmed, publikasi ke tenant + tunggu recovery. Attendance clock-in tetap jalan. |
| Access key expired / revoked  | Regenerate token di R2 dashboard, update `.env.production` (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`), `docker compose up -d --force-recreate api`.   |
| Bucket dihapus / dipindahkan  | Verifikasi via R2 dashboard. Kalau bucket hilang → **breach incident** (data attachments hilang) → file di `/admin/security/breaches`.                  |
| Endpoint typo di .env         | Grep `.env.production` untuk `S3_ENDPOINT`. Fix + recreate.                                                                                             |

**Impact user-facing**: attachment fail, tapi absence/permit tetap bisa disubmit tanpa file (fallback UI). Timesheet export baru tetap bisa dibuat, tapi share link gagal. Notify pengguna di banner UI (feature toggle).

---

## Skenario 3 — MFA Mass Lockout

**Gejala**

- Support tickets banjir: "tidak bisa login, MFA code invalid".
- Dashboard HR lock (semua HR terkunci karena MFA enforcement + tidak enroll).

**Diagnosis**

```bash
# Berapa banyak user aktif tapi MFA belum enroll?
docker compose exec postgres psql -U workpulse -d workpulse -c "
  SELECT COUNT(*), role FROM \"User\"
  WHERE \"deletedAt\" IS NULL
    AND (\"mfaEnrolledAt\" IS NULL)
    AND role IN ('HR_MANAGER','SUPER_ADMIN')
  GROUP BY role;
"

# NTP drift server? TOTP window is 30s, drift > 30s = TOTP always invalid.
timedatectl status
```

**Tindakan**

| Root cause                                                                   | Tindakan                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NTP drift di server                                                          | `sudo timedatectl set-ntp on`. Restart `chrony` / `systemd-timesyncd`. Verify: `chronyc tracking`.                                                                                                         |
| Bug: `MFA_SECRET_ENCRYPTION_KEY` di-rotate → semua secret unreadable         | **JANGAN** rotate key ini tanpa migration script. Rollback rotasi + restore key lama. Kalau sudah kelanjutan → semua user MFA harus re-enroll.                                                             |
| Enforcement dinaikkan (`MFA_ENFORCE_HR_ADMIN=true`) sebelum HR sempat enroll | Turunkan sementara ke `false` (**hanya boleh di staging** — production `env.validation` refuse `false`). Alternatif: SUPER_ADMIN reset MFA per-user via `/admin/users/:id/reset-mfa` (endpoint sudah ada). |
| Backup code hilang / lupa                                                    | User panggil support → SUPER_ADMIN reset MFA → user re-enroll.                                                                                                                                             |

**Kalau kejadian setelah incident nyata**: file breach incident (kalau ada indikasi credential compromise) — lihat `docs/WORKFLOW.md` §16.

---

## Skenario 4 — Webhook Backlog Explode

**Gejala**

- `/admin/webhooks/deliveries?status=PENDING` menunjukkan ratusan item.
- Payment / payroll integrasi client complain event terlambat.

**Diagnosis**

```bash
docker compose exec postgres psql -U workpulse -d workpulse -c "
  SELECT status, COUNT(*) FROM \"WebhookDelivery\"
  WHERE \"createdAt\" > now() - interval '1 day'
  GROUP BY status;
"

# Worker enabled?
curl -sS https://api.example.com/api/v1/health/deep | jq '.workers.webhook'

# Slow endpoint di sisi client?
docker compose logs api | grep -E "webhook.*(timeout|failed)" | tail -30
```

**Tindakan**

| Penyebab                                          | Tindakan                                                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Worker disabled (kill switch on)                  | Set `WEBHOOK_WORKER_ENABLED=true` + recreate api.                                                                                                            |
| Client endpoint down / DNS misconfig              | Notify tenant. Delivery akan retry per policy (30s, 5m, 30m, 6h). Setelah 4 attempts otomatis FAILED.                                                        |
| SSRF guard reject (client subscribe ke IP privat) | Konfirmasi ke tenant. Kalau valid (mis. tunnel internal via cloudflared), whitelist di code / infra. Jangan disable `WEBHOOK_BLOCK_PRIVATE_IPS` di produksi. |
| Rate-limited oleh client                          | Delivery akan back-off otomatis; tidak perlu intervensi.                                                                                                     |

**Manual retry all PENDING** (worst case):

```sql
-- Reset semua delivery yang stuck di locked-in-past
UPDATE "WebhookDelivery" SET "lockedAt" = NULL
WHERE status = 'PENDING' AND "lockedAt" < now() - interval '10 minutes';
```

---

## Skenario 5 — Breach Detected (Suspected Data Exposure)

**Gejala**

- Anomaly deteksi (Sentry alert / login pattern aneh).
- User laporan akunnya diakses tanpa authorization.
- Log show mass export dari 1 IP.

**Tindakan (dalam 60 menit)**

1. **Isolasi**: revoke session mencurigakan.
   ```sql
   -- Kill all refresh tokens for suspected user
   UPDATE "RefreshToken" SET "revokedAt" = now()
   WHERE "userId" = '<UUID>' AND "revokedAt" IS NULL;
   ```
2. **File breach incident** di `/admin/security/breaches` (Fase 31g).
   - Severity awal: minimum `MEDIUM` (kalau > 10 orang terpengaruh → `HIGH`).
   - Kategori: `CONFIDENTIALITY`.
   - `detectedAt` = sekarang, `occurredAt` = perkiraan dari log.
3. **72-jam clock berdetak.** Reminder worker akan mengingatkan:
   - T-24h → notifikasi WARNING.
   - T-4h → notifikasi CRITICAL.
   - T-0h → OVERDUE (langsung page ops + legal).
4. **Investigasi paralel**:
   - Sentry: search `event.transaction:*/admin/*` filter by user IP.
   - Postgres audit log: `SELECT * FROM "AuditLog" WHERE "userId"='<UUID>' AND "createdAt" > <suspected-start> ORDER BY "createdAt";`
   - Cek `LoginAttempt` untuk failed/success pattern.
5. **Advance status** di ledger:
   - `DETECTED → CONTAINED` — sekaligus revoke access.
   - `CONTAINED → NOTIFIED_AUTHORITY` — sebelum 72 jam expire, notifikasi otoritas (Kominfo Indonesia / PDP-controller relevan).
   - `NOTIFIED_AUTHORITY → NOTIFIED_SUBJECTS` — kirim email ke user terdampak.
   - `NOTIFIED_SUBJECTS → CLOSED` — setelah remediasi + post-mortem.
6. **PDF regulator** — via `/admin/security/breaches/:id/export.pdf`. Kirim ke lawyer/DPO.

Semua langkah otomatis tercatat di `BreachTimelineEvent` (append-only). Jangan pernah UPDATE atau DELETE row di sana.

---

## Skenario 6 — Cron Worker Stuck (Deadlock / Dead-lettered)

**Gejala**

- Metric worker tidak update (mis. `last-success` sudah > 2 hari).
- Timesheet baru tidak auto-generated.
- Reminder tidak terkirim.
- Analytics snapshot table stagnan.

**Diagnosis umum**

```bash
# Which worker last succeeded?
docker compose exec postgres psql -U workpulse -d workpulse -c "
  SELECT 'timesheet' AS worker, MAX(\"createdAt\") FROM \"TimesheetPeriod\"
  UNION ALL
  SELECT 'analytics', MAX(\"createdAt\") FROM \"AnalyticsSnapshot\"
  UNION ALL
  SELECT 'report',    MAX(\"createdAt\") FROM \"ReportDelivery\"
  UNION ALL
  SELECT 'webhook',   MAX(\"createdAt\") FROM \"WebhookDelivery\";
"

# Any stuck DB advisory locks (FOR UPDATE SKIP LOCKED bug)?
docker compose exec postgres psql -U workpulse -d workpulse -c "
  SELECT locktype, relation::regclass, pid, mode, granted
  FROM pg_locks WHERE NOT granted;
"
```

**Tindakan generic**:

1. Restart api container: `docker compose restart api` — akan re-schedule cron dari awal.
2. Kalau ada advisory lock yang stuck: `SELECT pg_advisory_unlock_all()` di session yang aman, atau kill process holding lock.
3. Kalau kill switch tidak sengaja `false` → set ke `true` di `.env.production` + recreate.

**Kalau data hilang antara restart terakhir dan sekarang**: worker didesain idempotent — jalankan run manual via endpoint admin (mis. `POST /admin/timesheets/scheduler/tick`) kalau tersedia, atau tunggu tick berikutnya.

---

## Skenario 7 — Container OOM Killed

**Gejala**

- `docker compose ps` menampilkan `Exited (137)` — 137 = 128 + SIGKILL (9), tanda OOM.
- `dmesg | grep -i "oom-kill"` di host memperlihatkan container name.

**Tindakan cepat**

1. Restart container: `docker compose up -d`.
2. Cek resource limit di `docker-compose.prod.yml` service tersebut. Baseline api = 1G limit.
3. Kalau OOM di api container, kemungkinan XLSX export terlalu besar → mitigate:
   - Kurangi `TIMESHEET_EXPORT_SHARE_TTL_HOURS` supaya payload disimpan lebih pendek (irrelevant, payload sudah persistent di DB).
   - Refactor export ke streaming (tickable future work — file di roadmap).
4. Kalau berulang → bump memory limit di compose + upgrade VPS RAM.

---

## Skenario 8 — TLS / Let's Encrypt Rate Limit

**Gejala**

- `docker compose logs caddy` menampilkan `too many failed authorizations` atau `certificate not renewed`.
- Browser warning "connection not secure" di app.

**Diagnosis**

- Berapa kali sudah retry dalam 1 minggu? Let's Encrypt limit 5 failure / hostname / week.
- Volume `caddy_data` masih hidup?

**Tindakan**

1. **JANGAN** hapus volume `caddy_data` — memicu re-issue yang bisa hit rate limit lagi.
2. Cek DNS: `dig +short api.example.com` — harus balik IP VPS.
3. Verifikasi port 80 accessible dari internet (Let's Encrypt HTTP-01 challenge): `curl -sS http://api.example.com/.well-known/acme-challenge/x`.
4. Kalau rate-limited, tunggu 1 minggu **atau** switch ke Let's Encrypt staging sementara (`caddy` env `ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory`) untuk test — lalu switch kembali.

---

## Skenario 9 — Full-Site Down (Everything)

Panic mode. Ikuti langkah ini urutan:

1. Panggil PIC lain di #ops. Jangan solo debug > 15 menit.
2. `curl -I https://app.example.com` — TLS handshake ok?
3. `ssh <vps>` — bisa masuk?
4. `docker compose ps` — semua container running?
5. `df -h`, `free -m`, `uptime` — resource sehat?
6. Kalau semuanya "aneh": `docker compose down && docker compose up -d`. Ini nuclear button.
7. Kalau **VPS totally unreachable**: DR ke VPS baru sesuai `docs/OPS/BACKUP-RESTORE.md` §5.

---

## Post-Incident Checklist

Dalam 5 hari kerja setelah resolve:

- [ ] Post-mortem doc di `docs/OPS/incidents/YYYY-MM-DD-<slug>.md` (buat folder saat incident pertama).
- [ ] Timeline lengkap dari detection sampai resolution.
- [ ] Root cause (bukan "kesalahan manusia" — proses yang membiarkan kesalahan lolos yang salah).
- [ ] Actions (owner + due date, minimum 1 preventive + 1 detective).
- [ ] Update runbook ini kalau ada skenario baru.
- [ ] Blameless — post-mortem review meeting < 30 menit.

Template lengkap ada di `docs/OPS/ON-CALL.md` §Post-Mortem Template.
