# ADR-0035: Breach Notification Ledger (Fase 31g)

- Status: Accepted
- Date: 2026-08-03
- Deciders: Engineering, DPO
- Phase: 31g

## Context

UU 27/2022 Pelindungan Data Pribadi (**UU PDP**) Pasal 46 ayat (3)
mewajibkan pengendali data memberitahukan pelanggaran perlindungan
data pribadi:

- Ke **Lembaga** (Kominfo) dan **Subjek Data** paling lambat
  **3 × 24 jam** sejak insiden diketahui.
- Bila terjadi kegagalan notifikasi tepat waktu, pengendali data
  wajib menyampaikan alasan.

GDPR Art. 33 (72 jam ke supervisory authority) + Art. 34 (undue delay
ke subjek data ketika berisiko tinggi) meng-align — jadi satu ledger
menutup kedua yurisdiksi.

Sebelum 31g, insiden hanya tercatat di `AuditLog` (system-driven) atau
di dokumen ad-hoc SecOps. Tidak ada single source of truth yang
regulator-friendly, deadline countdown, atau timeline yang legally
tamper-evident.

## Decision

Ship **`BreachIncident` + append-only `BreachTimelineEvent`** sebagai
regulator-facing ledger, di jalur admin `/admin/security/breaches`.

### Data model

- `BreachIncident` — head record dengan lifecycle status, timestamp
  hitting points (`detectedAt` / `containedAt` / `authorityNotifiedAt`
  / `subjectsNotifiedAt` / `closedAt`), impact fields
  (`affectedUserCount`, `affectedDataCategories`, `affectedSystems`),
  narrative fields (`description`, `containmentActions`, `rootCause`,
  `remediation`), dan notifikasi refs.
- `BreachTimelineEvent` — append-only event log:
  `CREATED / UPDATED / STATUS_ADVANCED / AUTHORITY_NOTIFIED /
   SUBJECTS_NOTIFIED / NOTE_ADDED / DEADLINE_WARNED / EXPORTED /
   CLOSED`. `REVOKE UPDATE, DELETE ON PUBLIC` di DB level — history
  tidak boleh di-rewrite.
- CHECK constraint `occurredAt IS NULL OR occurredAt <= detectedAt` +
  `affectedUserCount >= 0`.

### State machine

```
DETECTED ─┬─→ CONTAINED ─┬─→ NOTIFIED_AUTHORITY ──→ NOTIFIED_SUBJECTS ──→ CLOSED
          └────────────────┘         │                       │
                                     └─ CLOSE (LOW) ─────────┴──→ CLOSED
```

- Forward-only. Rewind ilegal — corrective action via NOTE_ADDED.
- Escape hatch `CLOSE` dari DETECTED/CONTAINED hanya untuk `LOW`
  severity yang terbukti tidak berisiko subjek data.
- `CLOSED` terminal — semua write ke incident ditolak dengan
  `BREACH_ALREADY_CLOSED`.

### Deadline math

- Anchor: `detectedAt + 72h`. Pure di `domain/deadline.ts`.
- Bucket: `SAFE > 24h → WARNING ≤ 24h → CRITICAL ≤ 4h → OVERDUE < 0`.
- **Countdown aktif** hanya di status `DETECTED` / `CONTAINED`. Sekali
  authority-notified, jam berhenti (kewajiban primer terpenuhi).
- FE tidak menghitung sendiri — API mengembalikan `deadline.bucket` +
  `hoursRemaining` per response.

### Reminder worker

Cron `0 */5 * * * *`:

1. Scan incidents dengan status DETECTED/CONTAINED.
2. Untuk masing-masing, hitung `bucketFor(hoursRemaining)`.
3. Dedup via `BreachTimelineEvent(eventType=DEADLINE_WARNED,
   metadata.bucket=...)` — satu warning per bucket per incident.
4. Fanout ke: `assignedTo` + `reportedBy` + semua `HR_MANAGER` /
   `SUPER_ADMIN` tenant. Notification type baru:
   `BREACH_DEADLINE_WARNING`.

Kill switch: `BREACH_REMINDER_WORKER_ENABLED` (default `true`).
Follower replicas set `false`.

### Audit + timeline pairing

Setiap mutation menulis **dua** rows dalam satu `$transaction`:

- `BreachTimelineEvent` — regulator-facing narrative.
- `AuditLog` — SecOps-facing forensic ("actor X did Y from IP Z").

`BREACH_INCIDENT_CREATED`, `BREACH_INCIDENT_UPDATED`,
`BREACH_CONTAINED`, `BREACH_NOTIFIED_AUTHORITY`,
`BREACH_NOTIFIED_SUBJECTS`, `BREACH_CLOSED`, `BREACH_NOTE_ADDED`,
`BREACH_DEADLINE_WARNED`, `BREACH_EXPORTED`.

### Regulator PDF

Endpoint `GET /admin/security/breaches/:id/export.pdf`. Audit-before-
stream (SHA-256 + `X-Payload-Sha256` header + `BREACH_EXPORTED` audit
row + `EXPORTED` timeline event, semua dalam satu `$transaction`,
BEFORE bytes go out). Layout:

1. Metadata perusahaan + DPO
2. Ringkasan (severity, kategori, dampak, deadline)
3. Kronologi (occurred / detected / contained / notified / closed)
4. Tindakan (containment / root cause / remediation)
5. Notifikasi (authority ref + subject template excerpt)
6. Timeline lengkap (append-only ledger)

Renderer via `pdfkit`, sama seperti ROPA/DPIA.

### RBAC

- `HR_MANAGER` — full CRUD, lifecycle transitions, export.
- `SUPER_ADMIN` — sama, plus tenant-scoping via companyId filter.
- Employees + supervisors — 403.

## Alternatives Considered

1. **Auto-populate dari AuditLog anomaly** — di-defer ke Fase 33d
   (Anomaly Detection). Anomaly rules belum matang; false-positive
   akan pollute ledger sebelum ada tuning window.
2. **Actual email delivery ke Kominfo** — manual out-of-band. API
   Kominfo tidak public; ledger cukup mencatat referensi + timestamp.
3. **Subject notification via bulk email** — pakai template
   record-only. Email actual dikirim via DSAR / existing channel;
   ledger hanya jadi tempat menyimpan template untuk audit.
4. **Anchor deadline di `occurredAt`** — regulator jelas: "sejak
   diketahui", jadi `detectedAt` benar.
5. **Countdown timer client-side** — ditolak; server yang otoritatif,
   FE hanya render.

## Consequences

- Positive: single source of truth untuk breach reporting;
  regulator-friendly PDF dengan SHA-256; countdown menghindari
  keterlambatan 72 jam via reminder T-24h / T-4h / OVERDUE; timeline
  append-only tahan tamper.
- Negative: manual data entry (mis. authority ref, subject template)
  tidak terintegrasi dengan email adapter; deferred integration
  dengan anomaly detection.
- Risk: DPO lupa transition status → mitigation via reminder worker
  + FE countdown badge yang mencolok.

## Rollback

Drop `BreachIncident` + `BreachTimelineEvent` tables. `BreachModule`
di-remove dari `AppModule`. `NotificationType.BREACH_DEADLINE_WARNING`
tetap ada (kompatibel) atau di-remove via ALTER TYPE separate
migration. Nothing lain yang bergantung.
