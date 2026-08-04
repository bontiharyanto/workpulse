# Workpulse — On-Call Rotation & Communication

Kekuatan mekanisme on-call bukan pada teknologi, tapi pada kejelasan **siapa** yang bertindak dan **kapan**.

---

## 1. Rotasi

**Beta** (pilot 1–10 tenant, tim < 5 orang):
- **1 primary** + **1 secondary**, rotasi mingguan.
- Handoff Senin 09:00 WIB di channel `#ops-handoff`.
- Primary bertanggung-jawab menjawab pager 24/7 selama shift-nya. Secondary sebagai backup kalau primary tidak available.

**Enterprise GA** (>10 tenant):
- Split ke 2 shift: **APAC** (00:00–12:00 UTC) + **EMEA** (12:00–24:00 UTC).
- 4 orang minimum per shift.

Tools: **PagerDuty Free** (5 user, 1 schedule) atau **Opsgenie Free**. Untuk Beta, boleh manual Google Calendar + Slack alert routing.

---

## 2. Severity Definisi

| Level | Definisi | SLA response | SLA resolution | Contoh |
|---|---|---:|---:|---|
| **P0** | Full outage — tenant tidak bisa clock-in / login. Data loss risk. Data breach confirmed. | 15 menit | 4 jam | DB down, seluruh site 5xx |
| **P1** | Feature critical rusak untuk banyak tenant. Approaching SLA breach. | 1 jam | 24 jam | MFA lockout, backup gagal 2 hari, breach reminder overdue |
| **P2** | Feature rusak untuk minoritas / workaround tersedia. | 4 jam | 5 hari kerja | Webhook backlog, notification delay, dashboard slow |
| **P3** | Cosmetic bug, dokumentasi salah. | 1 hari | Sprint berikutnya | Typo di UI, wrong tooltip |

SLA di atas dihitung dari **acknowledgment**, bukan dari waktu incident. On-call **wajib** ack dalam 15 menit setelah pager.

---

## 3. Communication Templates

### 3.1. Announce (dalam 15 menit)

Post di `#status` (channel bersama pilot tenant primary contacts):

```
:red_circle: [P0] Workpulse degraded/down

Impact:  Semua tenant di region ap-southeast, endpoint clock-in fail 5xx.
Started: 2026-08-15 08:32 WIB
Detected: Sentry alert 08:33 WIB
Owner:   @nama-oncall
Status:  Investigating.
Updates: Setiap 30 menit atau saat status berubah.
```

### 3.2. Update (setiap 30 menit atau saat status berubah)

```
:warning: [P0] Update 08:47 WIB

Progress: Postgres OOM-killed karena backup job overlap dengan peak.
Mitigation: Restart postgres + reschedule backup ke 03:00 WIB besok.
ETA resolve: 09:15 WIB.
Impact: Service degraded (10% error rate).
```

### 3.3. Resolve

```
:white_check_mark: [P0] Resolved 09:12 WIB

Duration: 40 menit total downtime.
Root cause: Backup + peak clock-in bersamaan memenuhi RAM (4 GB limit).
Fix: Reschedule backup ke off-peak + tambah swap 2GB sementara.
Post-mortem: Draft dalam 5 hari kerja → link.
Follow-up: Ticket #123 — upgrade VPS RAM sebelum tenant #4.
```

### 3.4. External comms (untuk tenant primary contact)

Tone berbeda: business-oriented, tidak leak internal.

```
Subject: [Workpulse] Service disruption — 40 menit downtime, resolved

Dear <primary contact>,

Antara 08:32 – 09:12 WIB pada 15 Agustus, layanan Workpulse mengalami
gangguan yang menyebabkan sebagian karyawan tidak dapat melakukan clock-in.

Root cause: Bug pada job scheduling backup yang overlap dengan jam puncak.
Mitigasi: Sudah diselesaikan pada 09:12 WIB. Backup dijadwal ulang untuk
menghindari peak hours.

Tidak ada data yang hilang. Data yang seharusnya masuk saat downtime bisa
dikoreksi lewat fitur "Attendance Correction" (approval Supervisor).

Kami akan berbagi post-mortem lengkap dalam 5 hari kerja. Silakan hubungi
support@workpulse.example.com untuk pertanyaan lanjutan.

— Workpulse Ops
```

---

## 4. Escalation Path

```
Primary on-call    ──ack < 15 min──▶  Handle
       │
       │  belum ack setelah 15 menit
       ▼
Secondary on-call  ──ack < 15 min──▶  Handle
       │
       │  belum ack setelah 30 menit total
       ▼
Engineering lead   ──▶  Manual page
       │
       │  P0 tetap belum resolve setelah 2 jam
       ▼
CTO / Founder      ──▶  Executive intervention + tenant CEO comm
```

---

## 5. Post-Mortem Template

Buat file `docs/OPS/incidents/YYYY-MM-DD-<slug>.md` dalam 5 hari kerja:

```markdown
# Incident YYYY-MM-DD: <one-line title>

**Severity**: P0 / P1 / P2
**Duration**: 40 menit (08:32 – 09:12 WIB)
**Tenants affected**: 5 (semua)
**Data loss**: None / N records anonymised / …
**Author**: @nama

## Summary

Dua-tiga kalimat non-technical yang jelas apa yang rusak dan bagaimana.

## Timeline (WIB)

- 08:31 — [BACKGROUND] Backup job dijadwal 08:30 pas dengan peak hour.
- 08:32 — Postgres OOM-killed, error rate 100% pada endpoint tulis.
- 08:33 — Sentry alert; BetterStack degradation triggered.
- 08:34 — @primary ack di #ops.
- 08:38 — Diagnosis: `dmesg` show OOM. Backup running.
- 08:42 — Kill backup process. `docker compose restart postgres`.
- 08:45 — Postgres sehat kembali; error rate turun.
- 09:12 — Semua metric normal; monitor 30 menit tambahan. Marked resolved.

## Root Cause

Backup job dijadwalkan 08:30 WIB (dari default `BACKUP_CRON=30 1 * * *` — 01:30 UTC = 08:30 WIB, konflik dengan peak clock-in). pg_dump menggunakan spare RAM yang seharusnya untuk shared_buffers Postgres.

## What Went Well

- Sentry alert triggered dalam 1 menit dari incident.
- Rollback playbook jelas — restart butuh 3 menit.
- Communication ke tenant primary jalan sesuai template.

## What Went Wrong

- Cron schedule tidak di-review saat sizing VPS dinaikkan.
- Tidak ada resource isolation antara backup + postgres container.

## Actions

| # | Owner | Due | Preventive/Detective/Corrective | Task |
|---|---|---|---|---|
| 1 | @ops | 2026-08-20 | Preventive | Reschedule `BACKUP_CRON` ke 20:00 UTC (03:00 WIB off-peak). Update `.env.production.example`. |
| 2 | @ops | 2026-08-22 | Detective | Add BetterStack alert: `p95(clock-in) > 1000ms selama 5 menit`. |
| 3 | @eng-lead | 2026-08-30 | Corrective | Add resource limit `deploy.resources.limits.memory` pada backup container. |
| 4 | @eng-lead | 2026-09-15 | Preventive | Explore `pg_dump` streaming ke S3 tanpa disk intermediate (mengurangi mem pressure). |

## Blameless Statement

Ini bukan kesalahan siapapun. Sistem membiarkan konfigurasi berbahaya lolos ke produksi tanpa alert — itu yang harus diperbaiki.
```

---

## 6. On-Call Kit (yang harus siap sebelum shift)

- [ ] SSH access ke `/opt/workpulse` di VPS produksi (SSH key sudah di `~/.ssh/authorized_keys`).
- [ ] Sudo password / recovery access (di password manager tim).
- [ ] Sentry access (member `workpulse-api-prod` project).
- [ ] BetterStack access (member workspace).
- [ ] Cloudflare R2 dashboard access (untuk melihat backup + attachments bucket).
- [ ] Slack `#ops` + `#status` channels bookmarked.
- [ ] File `.env.production` local copy (untuk diff cepat kalau perlu compare).
- [ ] Baca `INCIDENT-RESPONSE.md` sekali dalam bulan terakhir.
- [ ] Sudah pernah `./scripts/health-check.sh` sekali di staging.
- [ ] Sudah pernah `./scripts/rollback.sh` sekali di staging.

---

## 7. Do Not Do

- **JANGAN** ssh sebagai `root`. Selalu user personal dengan sudo.
- **JANGAN** edit `docker-compose.prod.yml` di server. Selalu via git + push.
- **JANGAN** hapus volume `caddy_data` — memicu Let's Encrypt rate-limit.
- **JANGAN** hapus row `AuditLog`, `BreachTimelineEvent`, `ReportDelivery`. Semua append-only. `REVOKE UPDATE, DELETE` di DB level akan reject.
- **JANGAN** rotate `MFA_SECRET_ENCRYPTION_KEY` tanpa migration plan — semua user harus re-enroll MFA.
- **JANGAN** commit `.env.production`. Ada di `.gitignore`, tapi triple-check `git status` sebelum commit.
- **JANGAN** run load test terhadap production. Selalu staging.

---

## 8. Bacaan Wajib Sebelum Duty

- `docs/OPS/DEPLOYMENT.md`
- `docs/OPS/BACKUP-RESTORE.md`
- `docs/OPS/MONITORING.md`
- `docs/OPS/INCIDENT-RESPONSE.md`
- `docs/OPS/PERFORMANCE.md` (skimming ok)
- `docs/WORKFLOW.md` §16 (Breach Notification Ledger — dalam kasus breach)
- `docs/ARCHITECTURE.md` (untuk mental model)
