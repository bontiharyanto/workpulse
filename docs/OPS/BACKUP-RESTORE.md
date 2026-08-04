# Workpulse — Backup & Restore Runbook

Status: **canonical** untuk pilot SMB Indonesia. Terakhir divalidasi: 2026-08-03.

---

## Ringkasan

- **Sumber**: Postgres 16 (self-hosted di VPS via `docker-compose.prod.yml`).
- **Destinasi**: Cloudflare R2 bucket privat, one-way (no public read).
- **Metode**: `pg_dump --format=custom` → `gzip` → `age -r <public-key>` → `rclone copyto`.
- **Enkripsi**: [age](https://age-encryption.org/) simetris ke public key. Private key **wajib** disimpan offline (password manager tim, YubiKey OTP, atau vault fisik).
- **Retensi**: 30 hari default (`BACKUP_RETENTION_DAYS`).
- **Cron**: 19:15 UTC harian = 02:15 WIB (`BACKUP_CRON=15 19 * * *`).

**RTO** (Recovery Time Objective): **≤ 2 jam** dari deteksi kehilangan data sampai layanan kembali online untuk tenant pilot. Terverifikasi di drill terakhir.
**RPO** (Recovery Point Objective): **≤ 24 jam**. Data yang di-commit setelah backup harian terakhir hilang saat DR total. Untuk RPO lebih ketat (mis. 1 jam) → aktifkan WAL archiving atau migrasi ke managed Postgres (Neon/Supabase punya PITR bawaan).

---

## 1. Arsitektur Pipeline

```
                ┌──────────────────────────────────────────────────────┐
                │  backup sidecar container (supercronic + pg_dump +   │
                │  gzip + age + rclone)                                 │
                └───────────────────┬──────────────────────────────────┘
                                    │
                                    │  1. pg_dump --format=custom  (streaming)
                                    │
                                    ▼
                              (in-memory pipe)                    NO plaintext
                                    │                              hits disk
                                    │  2. gzip -c
                                    │
                                    ▼
                              (in-memory pipe)
                                    │
                                    │  3. age -r <public-key>
                                    │
                                    ▼
                        workpulse-{db}-{timestamp}.dump.gz.age
                                    │
                                    │  4. rclone copyto
                                    │
                                    ▼
                    dest:${BACKUP_BUCKET}/workpulse/…
                    ├─  workpulse-workpulse-20260803T191500Z.dump.gz.age
                    ├─  workpulse-workpulse-20260802T191500Z.dump.gz.age
                    └─  …
```

Karena pipeline pakai stream + shell pipe, **plaintext dump tidak pernah menyentuh disk** — jauh lebih aman kalau host disita atau file sistem ke-dump.

---

## 2. Pengaturan Awal

### 2.1. Generate keypair age

Sekali per environment (staging + prod pakai keypair BERBEDA):

```bash
age-keygen -o /secure/backup-key.txt
# Output:
#   Public key: age1r4d7v2n8...   ← salin ke .env.production sebagai BACKUP_AGE_RECIPIENT
#   AGE-SECRET-KEY-1XY...          ← simpan OFFLINE. Tanpa ini backup tidak bisa didekripsi.
```

Simpan `/secure/backup-key.txt` di:
- Password manager tim (1Password vault "Ops secrets").
- YubiKey OTP / hardware token.
- Copy fisik di safety box kantor (opsional untuk paranoid mode).

**Rotasi**: setelah karyawan ops leave, generate keypair baru dan re-encrypt N backup terakhir. Prosedur ada di §7.

### 2.2. Konfigurasi R2 bucket

Di Cloudflare dashboard:

1. Create bucket `workpulse-backups`.
2. Enable **Object Versioning** (opsional tapi disarankan — memberi safety net ekstra saat prune script buggy).
3. Enable **Lifecycle Rule** untuk hard-delete non-current version > 60 hari (biar biaya storage tidak explode).
4. Create R2 API Token dengan scope **`workpulse-backups` — Read+Write only**. Token yang sama sebaiknya **tidak** dipakai untuk bucket attachments.

Isi `.env.production`:

```env
BACKUP_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
BACKUP_S3_ACCESS_KEY_ID=<token access key>
BACKUP_S3_SECRET_ACCESS_KEY=<token secret>
BACKUP_BUCKET=workpulse-backups
BACKUP_AGE_RECIPIENT=age1r4d7v2n8...
```

### 2.3. Boot sidecar

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d backup
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f backup
```

Log seharusnya menampilkan:
```
[backup] cron schedule: 15 19 * * * (UTC)
[backup] destination:   workpulse-backups/workpulse
[backup] retention:     30 days
[backup] entering supercronic loop.
```

### 2.4. First backup (verifikasi live)

```bash
./scripts/backup.sh
./scripts/list-backups.sh
```

`list-backups.sh` harus menampilkan ≥1 objek dengan ukuran > 0. Kalau kosong: cek log sidecar, periksa akses R2, konfirmasi `PGPASSWORD` benar.

---

## 3. Operasi Rutin

### 3.1. Cek status backup kemarin

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec backup \
  cat /var/lib/workpulse-backup/last-success
```

Format: `<TIMESTAMP> <OBJECT-KEY> <SIZE-BYTES>`. Nilai `<TIMESTAMP>` harus < 26 jam dari sekarang. Kalau tidak → escalate.

### 3.2. Backup manual sebelum operasi berbahaya

Sebelum migrasi Prisma yang destruktif, backfill besar, atau restore drill:

```bash
TAG=pre-migration-v20260901 ./scripts/backup.sh
```

Objek akan tersimpan di prefix `workpulse/manual/pre-migration-v20260901/…` — mudah dibedakan dari daily.

### 3.3. Inventory

```bash
./scripts/list-backups.sh                    # semua objek di prefix default
NEWEST=10 ./scripts/list-backups.sh          # 10 terbaru
./scripts/list-backups.sh workpulse/manual   # hanya backup manual
```

---

## 4. Drill Restore (WAJIB kuartalan)

Setiap kuartal, minimal satu drill di **VPS staging terpisah** (bukan primary!). Drill mengukur:
- Waktu total (unduh → dekripsi → load → sanity check).
- Ukuran dump aktual (untuk kapasitas planning).
- Bahwa **private key offline** benar-benar bisa dekripsi (kadang keypair yang salah tersimpan).

### 4.1. Sebelum drill

- Sewa VPS staging sementara (Hetzner CX22 murah, ~€4/mo).
- Copy `.env.production` ke VPS staging, **ganti** `POSTGRES_*` dengan credential lokal-only. Jangan pakai bucket produksi (destination-nya tidak dipakai untuk drill — cukup source).
- Copy private key `AGE-SECRET-KEY-…` dari password manager ke `/root/backup-key.txt` (chmod 600).

### 4.2. Jalankan drill

```bash
cd /opt/workpulse
docker compose -f docker-compose.prod.yml --env-file .env.production up -d postgres backup

# Identifikasi backup terbaru.
NEWEST=1 ./scripts/list-backups.sh
# → 2026-08-03 19:15:22    12345678  workpulse-workpulse-20260803T191500Z.dump.gz.age

AGE_IDENTITY_FILE=/root/backup-key.txt \
  BACKUP_OBJECT=workpulse-workpulse-20260803T191500Z.dump.gz.age \
  ./scripts/restore.sh
```

Script akan:
1. Unduh dari R2.
2. Dekripsi dengan private key.
3. Buat DB `workpulse_restored_<timestamp>`.
4. `pg_restore` (custom format, `--no-owner`).
5. Sanity check: cetak count `User`, `Company`, `Attendance`, `LeaveRequest`, `AuditLog`.

### 4.3. Kriteria sukses

- Restore selesai < RTO target (2 jam) untuk ukuran DB pilot (< 500 MB).
- Row counts ≥ baseline yang tercatat di `docs/OPS/DEPLOYMENT.md` §10 deploy log terakhir.
- Tidak ada error pada `pg_restore` di stderr (`--exit-on-error` mencegah silent skip).
- Login ke restored DB via `psql` dan spot-check 3 record acak (mis. `User.email` masih terenkripsi/hashed).

### 4.4. Post-drill

- Buat entry di `docs/OPS/RUNBOOK-INDEX.md` dengan tanggal, durasi total, PIC.
- **Destroy staging VPS + wipe `/root/backup-key.txt`**. Data user tenant tidak boleh menetap di lingkungan yang tidak diaudit.
- Kalau drill gagal → **P0 incident** → freeze semua deploy sampai backup pipeline diperbaiki.

---

## 5. Disaster Recovery (skenario primary down)

Alur untuk kondisi worst-case: VPS primary hilang (provider outage lama, disk corrupt, security incident).

1. **Deklarasi**: PIC mengumumkan DR di channel #ops. Timestamp dicatat — ini adalah T=0 untuk RTO.
2. **Provision VPS baru**: sama region + spec dengan primary. Ikuti `docs/OPS/DEPLOYMENT.md` §1–3.1.
3. **Config**: salin `.env.production` dari password manager (**bukan** dari VPS lama — mungkin sudah compromised).
4. **Restore terbaru**:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d postgres backup
   NEWEST=1 ./scripts/list-backups.sh   # dapatkan object key terbaru
   AGE_IDENTITY_FILE=/root/backup-key.txt \
     BACKUP_OBJECT=<key> \
     ./scripts/restore.sh
   ```
5. **Swap database name**:
   ```sql
   ALTER DATABASE workpulse RENAME TO workpulse_empty_placeholder;
   ALTER DATABASE workpulse_restored_XXXX RENAME TO workpulse;
   ```
6. **Start rest of stack**:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d
   ```
7. **DNS cutover**: update A record ke IP VPS baru. TTL 300s → propagasi < 10 menit.
8. **Verifikasi**: `./scripts/health-check.sh` + login manual dengan akun super admin.
9. **Post-incident**: file breach incident (kalau relevan) via `/admin/security/breaches` — lihat `docs/WORKFLOW.md` §16.

---

## 6. Alerting Backup Failure

Backup sidecar tidak punya notifikasi built-in. Untuk pilot cukup:

**External monitor** (BetterStack / UptimeRobot free tier):
- Setup **heartbeat check** dengan interval 25 jam.
- Tambahkan curl POST ke heartbeat URL di ujung `run-backup.sh`:
  ```bash
  # Di run-backup.sh, sebelum log "backup run complete":
  if [ -n "${HEARTBEAT_URL:-}" ]; then
    curl -fsS --max-time 5 "${HEARTBEAT_URL}" >/dev/null || true
  fi
  ```
- Alert channel: PagerDuty / Slack #ops / email PIC.

Kalau > 25 jam tidak ada heartbeat → alert. Batas 25 jam memberi buffer 1 jam sebelum SLA.

---

## 7. Rotasi Private Key age

Jarang, tapi wajib saat:
- Ops PIC keluar dan sempat pegang private key.
- Suspected compromise pada password manager.
- Rutin tahunan (best practice).

Prosedur:

1. `age-keygen` → generate keypair baru.
2. Update `BACKUP_AGE_RECIPIENT` di `.env.production` → recreate backup sidecar (`docker compose … up -d --force-recreate backup`).
3. Backup **baru** akan otomatis pakai key baru. Backup lama masih hanya bisa dibuka dengan key lama.
4. **Re-encrypt** backup lama yang masih perlu di-retain:
   ```bash
   # Contoh loop (jalankan di VPS operator/laptop dengan akses ke SECRET_OLD + SECRET_NEW):
   for OBJ in $(rclone lsf dest:workpulse-backups/workpulse/); do
     rclone copyto dest:workpulse-backups/workpulse/$OBJ /tmp/in.age
     age -d -i /secure/old-key.txt /tmp/in.age \
       | age -r ${NEW_RECIPIENT} -o /tmp/out.age
     rclone copyto /tmp/out.age dest:workpulse-backups/workpulse/$OBJ
     rm /tmp/in.age /tmp/out.age
   done
   ```
5. Setelah confirm bisa didekripsi dengan key baru → **destroy** key lama di semua tempat (password manager, YubiKey, safety box).

---

## 8. Batasan yang Diketahui + Rencana Upgrade

| Batasan | Dampak | Rencana upgrade |
|---|---|---|
| RPO 24 jam | Data 24 jam terakhir hilang saat DR total | Aktifkan WAL archiving ke R2 (via `wal-g`), atau migrasi ke Neon/Supabase yang punya PITR default. Effort: 1–2 hari. |
| Restore drill manual | Butuh operator kuartalan | Otomatis via GitHub Action yang provision VPS ephemeral + jalankan drill + hancurkan. Effort: 3–5 hari. |
| Single-region | Kalau seluruh region R2 down, backup unreachable | Enable R2 cross-region replication (Cloudflare feature) atau mirror ke bucket B2/S3 sebagai fallback. Effort: 1 hari. |
| pg_dump lock table pendek | Untuk DB > 5 GB dump bisa memakan 5–10 menit lock read | Migrasi ke logical replication + Postgres streaming backup. |

Semua di atas berlebihan untuk 1–10 tenant. Angkat prioritas begitu DB tembus 5 GB atau tenant count > 15.
