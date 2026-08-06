# E2E & Testing Guide

Panduan **praktik** untuk QA / QC / Tester Workpulse — dari filosofi
testing pyramid, cara menulis test yang bertahan lama, debug flake,
sampai integrasi CI. Complement dari:

- [TESTING.md](./TESTING.md) — strategi & arsitektur test (kapan pakai unit vs E2E).
- [UAT-E2E.md](./UAT-E2E.md) — 78 skenario UAT untuk sign-off manual pre-go-live.
- [DEMO-USERS.md](./DEMO-USERS.md) — kredensial demo & fixture yang di-seed.

Dokumen ini fokus **cara mengerjakan** test, bukan hanya strategi.

---

## 1. Testing pyramid Workpulse

```
                                ┌───────────────┐
                                │      UAT      │  Manual — sign-off release
                                │  (78 skenario)│  Pemangku: HR + engineering
                                └───────────────┘
                                        ▲
                                        │
                              ┌─────────────────────┐
                              │  E2E (Playwright)   │  Otomatis — 44 spec
                              │  real API + Postgres│  Cakupan: wire-up
                              │  ~ 8 menit di CI    │  correctness
                              └─────────────────────┘
                                        ▲
                                        │
                        ┌─────────────────────────────────┐
                        │  Integration tests (opsional)    │  Belum di-adopsi
                        │  Testcontainers + real DB        │  di MVP; kandidat
                        └─────────────────────────────────┘
                                        ▲
                                        │
                    ┌───────────────────────────────────────────┐
                    │  Unit tests (Jest + mocked Prisma)        │  Cakupan
                    │  Domain + service — ~ 2 detik per suite   │  branch/logic
                    └───────────────────────────────────────────┘
```

### 1.1 Rasio target

| Lapis       | Jumlah target       | Kondisi hijau             | Investasi maintain     |
| ----------- | ------------------- | ------------------------- | ---------------------- |
| Unit        | ratusan             | 100% pass, coverage ≥ 80% | Rendah — cepat + murah |
| Integration | opsional            | 100% pass                 | Sedang                 |
| E2E         | ~ 40–60             | 100% pass (setelah retry) | Tinggi — jaga flake    |
| UAT manual  | sesuai release note | Semua P0/P1 pass          | Tinggi — waktu manusia |

**Aturan emas Workpulse:** setiap logika bisnis punya **unit test yang
memverifikasi setiap cabang**; setiap fitur punya **satu E2E happy-path**
yang memverifikasi kabel FE ↔ BE ↔ DB tersambung. Jangan pernah
menulis E2E untuk logika yang sudah di-cover unit (mis. konversi mata
uang, formula pajak) — lambat, mahal maintain.

### 1.2 Kapan pakai E2E vs Unit vs Manual?

| Yang di-tes                                | Pilihan                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Perhitungan matematis / logika bisnis pure | **Unit test service** (mock Prisma)                                         |
| Query Prisma + transaction                 | **Integration test** atau service test dengan `PrismaMock` yang cukup nyata |
| Route + guard + validation pipe            | Test controller (`nestjs/testing` module)                                   |
| Alur end-to-end lintas role                | **E2E Playwright**                                                          |
| RBAC gating di API                         | E2E Playwright (`authenticateApi` helper)                                   |
| RBAC gating di UI                          | E2E Playwright (`loginAs` + assert URL)                                     |
| Visual regression (layout, warna)          | UAT manual atau tool visual dedicated                                       |
| Performance ≥ 100 concurrent user          | k6 load test (bukan E2E)                                                    |
| Deep interaction hardware (GPS, kamera)    | UAT manual — Playwright hanya mock                                          |

---

## 2. Anatomi test yang baik

Setiap E2E spec sebaiknya memenuhi **Arrange-Act-Assert (AAA)** + tiga
prinsip anti-flake:

```typescript
// apps/e2e/tests/example.spec.ts
import { expect, test } from '@playwright/test';

import { loginAs } from './helpers/login';
import { daysFromToday } from './helpers/dates';

test('leave: employee submits → supervisor approves', async ({ browser }) => {
  // ---- ARRANGE — data yang test ini butuhkan (bukan yang seed sediakan) ----
  const runId = `e2e-leave-${Date.now()}`;
  const startDate = daysFromToday(7);
  const endDate = daysFromToday(8);

  // Setiap role pakai context sendiri (Incognito equivalent) — no cookie bleed
  const empCtx = await browser.newContext();
  const empPage = await empCtx.newPage();

  // ---- ACT — interaksi yang meng-drive sistem --------------------------------
  await loginAs(empPage, 'employee');
  await empPage.goto('/leave');
  await empPage.locator('#reason').fill(`Family — ${runId}`);
  // ... isi form
  await empPage.getByRole('button', { name: 'Ajukan', exact: true }).click();

  // ---- ASSERT — efek yang teramati, bukan implementasi ----------------------
  await expect(empPage.getByText(`Family — ${runId}`)).toBeVisible({
    timeout: 10_000,
  });

  await empCtx.close();
});
```

### 2.1 Tiga prinsip anti-flake

1. **Assert on effect, bukan implementation.** "Row muncul di list"
   (efek dari save berhasil) lebih tahan lama daripada "class CSS
   `.btn-loading` hilang" (detail implementasi).
2. **Setiap test punya scope data sendiri.** Embed `runId` unik di setiap
   pengajuan → re-run terhadap DB yang sama tidak collide.
3. **Tunggu efek, bukan waktu.** `expect(...).toBeVisible()` /
   `waitForResponse` / `waitForURL` — **jangan** `waitForTimeout(1000)`.

---

## 3. Selector strategy — urutan preferensi

Selector terbaik = paling stabil terhadap perubahan UI. Pilih dari atas
ke bawah:

| Prioritas | Selector                                            | Contoh                                                                                    |
| --------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1         | `getByRole` + name                                  | `page.getByRole('button', { name: 'Ajukan', exact: true })`                               |
| 2         | `getByLabel` (form input dengan `<label htmlFor>`)  | `page.getByLabel('Alasan')`                                                               |
| 3         | `getByPlaceholder`                                  | `page.getByPlaceholder('cari karyawan…')`                                                 |
| 4         | `getByTestId` — bila 1-3 tidak cukup discriminating | `page.getByTestId('leave-row-approve-btn')` — HTML: `data-testid="leave-row-approve-btn"` |
| 5         | ID selector (`#leaveTypeId`)                        | Dipakai di seluruh Workpulse untuk `<input id="…">` — stabil selama form label tetap.     |
| 6         | Text content (dengan `hasText`)                     | `page.locator('tr', { hasText: runId })` — bila unik dalam scope.                         |
| 7         | CSS class / structural                              | **HINDARI.** `page.locator('.btn-primary')` — kelas Tailwind bisa berubah tiap redesign.  |
| 8         | XPath                                               | **HINDARI.** Selalu kompleks, sulit di-review.                                            |

### 3.1 Aturan Workpulse

- **Copy Indonesia** untuk button label boleh dipakai (`'Masuk'`, `'Ajukan'`, `'Setujui'`) karena copy di-audit di PR. Kalau berubah, test-nya juga berubah — dokumentasikan di CHANGELOG.
- **`exact: true`** wajib bila ada button dengan nama serupa (mis. "Simpan" vs "Simpan & Kirim").
- **Scope dengan `locator(...).locator(...)`** untuk avoid ambiguity:

  ```typescript
  const row = page.getByRole('row', { name: /Rina Kartika/ });
  await row.getByRole('button', { name: 'Setujui' }).click();
  ```

### 3.2 Anti-pattern

```typescript
// ❌ CSS structural — pecah kalau order berubah
await page.locator('table tr:nth-child(3) td:nth-child(5) button').click();

// ❌ CSS Tailwind — pecah kalau desain di-refresh
await page.locator('.bg-emerald-500').click();

// ❌ XPath — sulit maintain
await page.locator('//div[@class="card"]//button[text()="Setujui"]').click();

// ✅ Role + name — tahan terhadap redesign
await page.getByRole('button', { name: 'Setujui', exact: true }).click();

// ✅ Data-testid — kontrak eksplisit dengan FE
await page.getByTestId('leave-approve-btn').click();
```

---

## 4. Waiting & synchronization

Semua flake E2E bersumber dari **race condition antara test dan
aplikasi**. Playwright default sudah menyediakan auto-wait untuk
`click`, `fill`, `expect(...).toBe*`. Yang perlu Anda tambahkan hanya
di titik-titik transisi state.

### 4.1 Tools waiting resmi

| Yang di-tunggu                         | Cara                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| Element muncul                         | `await expect(locator).toBeVisible({ timeout: 10_000 })`                       |
| Element hilang                         | `await expect(locator).toBeHidden()`                                           |
| URL berubah (login, submit → redirect) | `await page.waitForURL(/\/dashboard/, { timeout: 10_000 })`                    |
| Response API tertentu                  | `await page.waitForResponse((r) => r.url().endsWith('/api/v1/leave'))`         |
| Request API di-fire (untuk assert)     | `const [req] = await Promise.all([page.waitForRequest(...), page.click(...)])` |
| Element count berubah                  | `await expect(rows).toHaveCount(3, { timeout: 5_000 })`                        |
| Custom condition (rare)                | `await page.waitForFunction(() => document.readyState === 'complete')`         |

### 4.2 Anti-pattern

```typescript
// ❌ Sleep buta — flaky di CPU-starved runner
await page.waitForTimeout(1000);

// ❌ Polling manual
for (let i = 0; i < 10; i++) {
  const found = await page.locator('.row').count();
  if (found > 0) break;
  await page.waitForTimeout(500);
}

// ✅ Wait for effect
await expect(page.locator('.row')).toHaveCount(1, { timeout: 5_000 });
```

### 4.3 Chain waits di transisi kompleks

```typescript
// Klik "Setujui" → API POST → row berpindah dari "Pending" ke "Approved"
await Promise.all([
  page.waitForResponse(
    (r) =>
      r.url().includes('/api/v1/leave/') && r.request().method() === 'POST' && r.status() === 200,
  ),
  page.getByRole('button', { name: 'Setujui', exact: true }).click(),
]);
await expect(page.getByText('Approved')).toBeVisible();
```

---

## 5. Test data management

### 5.1 Sumber data yang di-pakai test

| Sumber                                | Kapan dipakai                                               |
| ------------------------------------- | ----------------------------------------------------------- |
| **Seed baseline** (4 user, `seed.ts`) | Kredensial login — jangan pernah override.                  |
| **Seed UAT** (`seed-uat.ts`)          | Data historical untuk skenario "read-only" — jangan modify. |
| **Data dibuat test**                  | Data mutable — leave request, OT request, correction, dst.  |

**Aturan:** setiap test **membuat data yang di-mutasi-nya sendiri**.
Seed hanya menyediakan **prerequisites** (user, department, shift,
holiday, leave type). Jangan pernah mutate seed data — test lain
mungkin tergantung padanya.

### 5.2 Isolasi antar-test — `runId`

```typescript
const runId = `e2e-<feature>-${Date.now()}`;

// Embed ke reason string, subject notification, dsb.
await page.locator('#reason').fill(`Cuti keluarga — ${runId}`);
```

Manfaat:

- Test-2 tidak collide dengan test-1 yang state-nya belum bersih.
- Re-run di DB yang sama tidak stuck karena duplicate constraint.
- Pas debug via UI Mode, Anda bisa filter row via `runId`.

### 5.3 Cleanup hygiene (pre-flight)

Beberapa spec pakai pre-flight cleanup untuk memastikan DB tidak
carry-over state dari run sebelumnya (lihat [ADR-0015](./ADR/ADR-0015-e2e-test-hygiene.md)):

```typescript
import { cancelLeaveOverlapping } from './helpers/cleanup';

test.beforeEach(async () => {
  await cancelLeaveOverlapping(startDate, endDate);
});
```

Pattern ini dipakai untuk data yang punya **overlap constraint**
(leave, OT). Untuk data yang unik per `runId`, cleanup tidak perlu.

### 5.4 API-level fixture — kapan skip UI

Bila prasyarat data butuh 5+ klik yang bukan bagian dari yang di-test,
buat data via API langsung:

```typescript
import { authenticateApi } from './helpers/api';

test.beforeAll(async ({ playwright }) => {
  const api = await authenticateApi(playwright, 'hr');
  await api.post('/api/v1/admin/leave-types', {
    data: { code: 'E2E_TEMP', name: `Temp ${runId}` /* ... */ },
  });
});
```

**Keputusan trade-off:**

- Jika alur setup itu **sendiri** yang di-tes → pakai UI.
- Jika alur setup hanya prasyarat → pakai API (lebih cepat, tidak flaky).

---

## 6. Playbook per skenario Workpulse

### 6.1 Login sederhana

```typescript
import { loginAs } from './helpers/login';

await loginAs(page, 'employee'); // 'employee' | 'supervisor' | 'hr' | 'admin'
```

### 6.2 Login user yang butuh MFA

```typescript
import { loginWithMfa } from './helpers/mfa';

// User hr2@acme.test punya TOTP secret di-seed
await loginWithMfa(page, 'hr2@acme.test', 'password123', secretFromSeed);
```

Detail: `apps/e2e/tests/helpers/mfa.ts` + [DEMO-USERS.md §3](./DEMO-USERS.md#3-mfa-enabled-user--hr2acmetest).

### 6.3 Multi-role coordination

```typescript
test.describe.configure({ mode: 'serial' });

test('leave: 3-role flow', async ({ browser }) => {
  const empCtx = await browser.newContext();
  const supCtx = await browser.newContext();
  const hrCtx = await browser.newContext();

  const emp = await empCtx.newPage();
  const sup = await supCtx.newPage();
  const hr = await hrCtx.newPage();

  await loginAs(emp, 'employee');
  await loginAs(sup, 'supervisor');
  await loginAs(hr, 'hr');

  // ... interaksi berurutan

  await Promise.all([empCtx.close(), supCtx.close(), hrCtx.close()]);
});
```

Setiap role dapat context sendiri (Incognito equivalent). **Jangan**
pakai `page.goBack()` atau share single page — cookie session akan bocor.

### 6.4 Form React Hook Form + Zod

```typescript
// Fill in urutan yang natural (top-to-bottom)
await page.locator('#email').fill('user@example.test');
await page.locator('#password').fill('correct-password');

// Trigger validasi RHF dengan blur / submit
await page.getByRole('button', { name: 'Masuk' }).click();

// Assert error message dari Zod resolver
await expect(page.getByRole('alert')).toContainText('Email tidak valid');
```

### 6.5 Dropdown / select

Workpulse pakai `<select>` native (bukan Radix combobox) untuk form
sederhana:

```typescript
const typeSelect = page.locator('#leaveTypeId');

// Tunggu options ter-load (fetched dari TanStack Query)
await expect(typeSelect.locator('option:not([value=""])')).not.toHaveCount(0, {
  timeout: 10_000,
});

// Pilih by label (tidak selalu bisa — cek pola di leave.spec.ts)
const value = await typeSelect
  .locator('option', { hasText: /Annual Leave/i })
  .first()
  .getAttribute('value');
if (!value) throw new Error('Option not found');
await typeSelect.selectOption(value);
```

Untuk Radix Combobox / Shadcn Select:

```typescript
await page.getByRole('combobox', { name: 'Jenis Cuti' }).click();
await page.getByRole('option', { name: 'Annual Leave' }).click();
```

### 6.6 Table row action

```typescript
// Locate row berdasarkan unique text di dalamnya
const row = page.getByRole('row', { name: new RegExp(runId) });
await row.getByRole('button', { name: 'Setujui', exact: true }).click();

// Assert transition
await expect(row).toContainText('APPROVED');
```

### 6.7 File download

```typescript
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Export CSV' }).click(),
]);

const path = await download.path();
expect(await download.suggestedFilename()).toMatch(/\.csv$/);

// Baca content untuk assertion (opsional)
import { readFileSync } from 'node:fs';
const content = readFileSync(path!, 'utf-8');
expect(content).toContain('userId,workDate,hours');
```

### 6.8 File upload (S3 presigned)

```typescript
// Presigned upload → PUT ke MinIO, kemudian kirim `key` ke API
await page.setInputFiles('input[type="file"]', './fixtures/doctor-note.pdf');

await Promise.all([
  page.waitForResponse((r) => r.url().includes('/attachments/presign-put')),
  page.getByRole('button', { name: 'Upload' }).click(),
]);
```

### 6.9 Geolocation (clock-in)

Playwright mendukung mock geolocation:

```typescript
const ctx = await browser.newContext({
  geolocation: { latitude: -6.2088, longitude: 106.8456 }, // Jakarta CBD
  permissions: ['geolocation'],
});
const page = await ctx.newPage();

await loginAs(page, 'employee');
await page.goto('/attendance');
await page.getByRole('button', { name: 'Clock In' }).click();

await expect(page.getByText('Berhasil clock in')).toBeVisible();

// Simulasi di luar geofence
await ctx.setGeolocation({ latitude: 0, longitude: 0 });
```

### 6.10 API-level test (bypass UI)

Untuk endpoint admin yang tidak punya UI atau untuk RBAC matrix:

```typescript
import { authenticateApi } from './helpers/api';

test('RBAC: audit-log', async ({ playwright }) => {
  for (const role of ['hr', 'admin']) {
    const api = await authenticateApi(playwright, role);
    const res = await api.get('/api/v1/admin/audit-log?limit=5');
    expect(res.status()).toBe(200);
  }
  for (const role of ['employee', 'supervisor']) {
    const api = await authenticateApi(playwright, role);
    const res = await api.get('/api/v1/admin/audit-log?limit=5');
    expect(res.status()).toBe(403);
  }
});
```

### 6.11 Notification / real-time update

```typescript
// Trigger event yang seharusnya menaikkan unread count
await employeePage.getByRole('button', { name: 'Ajukan' }).click();

// Cek di context supervisor
await supervisorPage.reload(); // atau tunggu SSE / polling refresh
const bell = supervisorPage.getByRole('button', { name: /notifikasi/i });
await expect(bell).toContainText('1');
```

---

## 7. Debugging playbook

Ketika test gagal, langkah berikut dari **paling cepat** ke **paling detail**:

### 7.1 Baca output CLI

Playwright print stack trace + line yang gagal. 60% masalah selesai
di sini bila error jelas (`expected visible, got hidden`).

### 7.2 Buka HTML report

```bash
pnpm e2e:report
```

Klik test yang gagal → tab **Trace** → **Actions** → replay tiap step.
Report menyertakan **screenshot on-failure** default.

### 7.3 Playwright Inspector — jalankan interaktif

```bash
pnpm --filter @workpulse/e2e exec playwright test leave.spec.ts --debug
```

- Membuka browser dengan Playwright Inspector di samping.
- Pause di setiap action → step through.
- Klik element di browser → salin selector yang recommended.

### 7.4 UI Mode — time-travel

```bash
pnpm e2e:ui
```

Modus paling kaya untuk debug:

- Watch mode — auto re-run saat file berubah.
- Time-travel — hover timeline untuk lihat state DOM di setiap moment.
- Console + network per step.

### 7.5 `page.pause()` — breakpoint inline

Sisipkan di dalam test:

```typescript
await page.getByRole('button', { name: 'Ajukan' }).click();
await page.pause(); // ← eksekusi berhenti, Inspector terbuka
await expect(page.getByText('Sukses')).toBeVisible();
```

### 7.6 Headed mode — lihat browser langsung

```bash
pnpm e2e:headed
# atau
PWDEBUG=1 pnpm e2e
```

### 7.7 Traces (retry hanya)

Config default: `trace: 'on-first-retry'`. Trace hanya tersimpan kalau
test **retry** — untuk debugging manual, override:

```bash
pnpm --filter @workpulse/e2e exec playwright test --trace on
```

Lalu:

```bash
pnpm --filter @workpulse/e2e exec playwright show-trace test-results/leave-e2e/trace.zip
```

### 7.8 VS Code extension

`ms-playwright.playwright` menyediakan:

- Gutter "Run test" / "Debug test" di setiap `test(...)` blok.
- Live browser panel.
- Pick locator dari browser dengan klik.

---

## 8. Flake taxonomy & remediation

Flake = test yang kadang hijau, kadang merah **tanpa** perubahan kode.
Kategorisasi + fix:

| Kategori            | Gejala                                             | Fix                                                                         |
| ------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| **Race async**      | Element belum muncul saat di-assert                | Ganti `waitForTimeout` dengan `expect(...).toBeVisible({ timeout })`.       |
| **Stale state**     | Data run sebelumnya masih ada                      | Embed `runId`. Pre-flight cleanup untuk data unique-constraint.             |
| **Cookie bleed**    | Session role sebelumnya masih aktif                | Buat `browser.newContext()` per role. Jangan share page.                    |
| **Time-based**      | `Date.now()` di test ≠ waktu server                | Pakai `daysFromToday(n)` yang delegasi ke helper. Hindari raw ISO string.   |
| **Throttler**       | Login berkali-kali dalam 60s → 429                 | Env `THROTTLER_DISABLED=true` di E2E config (sudah ada).                    |
| **DB contention**   | Prisma pool habis di CI runner mungil              | `workers: 1` di playwright.config.ts (sudah ada).                           |
| **Migration drift** | Test baru pull DB schema lama                      | `global-setup.ts` run `migrate deploy + seed` (sudah ada).                  |
| **Network flake**   | S3 / MinIO up sesaat setelah container start       | Config `webServer.url` health check → tunggu 200 dulu.                      |
| **Load flake**      | CI runner CPU-starved → animasi belum selesai      | Naikkan `timeout` untuk operasi berat. Atau disable animasi di test config. |
| **Copy drift**      | Copy Indonesia berubah, test masih pakai yang lama | Pakai `getByRole` bukan text. Update copy + test dalam PR yang sama.        |

### 8.1 SLA flake

Kalau spec **flake > 5% (retry pass rate)** di CI selama 2 minggu berturut:

1. Buka issue label `flaky-test`.
2. Isolasi: `test.skip` untuk stop bleeding hijau CI orang lain.
3. Root-cause dengan traces + video.
4. Fix + un-skip.

Jangan biarkan flaky test hidup — mengikis kepercayaan seluruh suite.

### 8.2 Retries

Config default: `retries: CI ? 2 : 0`. Rasional:

- Lokal — flake harus jelas terlihat sebelum push.
- CI — 2 retry menyerap infra flake (jaringan, container starting)
  tanpa menyembunyikan bug asli.

Jika test **hanya** pass di retry berulang, itu bug — bukan retry-worthy.

---

## 9. CI integration

Job `e2e` di `.github/workflows/ci.yml`:

```yaml
- name: Setup Postgres
  services:
    postgres:
      image: postgres:15-alpine
      env: { POSTGRES_USER: workpulse, POSTGRES_PASSWORD: workpulse }
      options: >-
        --health-cmd pg_isready
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5

- name: Install Playwright browsers
  run: pnpm e2e:install

- name: Run E2E
  run: pnpm e2e
  env:
    CI: true

- name: Upload HTML report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: playwright-report
    path: apps/e2e/playwright-report/
    retention-days: 7

- name: Upload traces (failure only)
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: playwright-traces
    path: apps/e2e/test-results/
    retention-days: 7
```

### 9.1 Artifact yang di-upload

| Artifact             | Kapan       | Isi                                               |
| -------------------- | ----------- | ------------------------------------------------- |
| `playwright-report/` | Selalu      | HTML report — semua run, dengan link ke trace.    |
| `test-results/`      | Hanya gagal | trace.zip + video.webm + screenshot.png per test. |

### 9.2 Retries di CI

```javascript
retries: CI ? 2 : 0,
```

Total attempt = 3 (initial + 2 retry). Rasional [ADR-0015](./ADR/ADR-0015-e2e-test-hygiene.md).

### 9.3 Sharding (skala berikutnya)

Sekarang `workers: 1` (avoid Prisma pool contention). Ketika suite
tumbuh > 15 menit, adopsi sharding matrix:

```yaml
strategy:
  matrix:
    shard: [1/4, 2/4, 3/4, 4/4]
steps:
  - run: pnpm e2e --shard=${{ matrix.shard }}
```

Kondisi: setiap test **benar-benar isolated** (no shared state).
Sudah memenuhi karena `runId` per-test.

---

## 10. Reporting & sign-off

### 10.1 HTML report

`pnpm e2e:report` — buka report interaktif dengan filter (pass/fail/skip),
timeline, screenshot, trace embed.

### 10.2 GitHub Actions job summary

Reporter `github` (aktif saat `CI=true`) auto-post summary di:

- **Pull request checks** — pass/fail count + link ke artifact.
- **Actions run summary** — table breakdown per spec.

### 10.3 Coverage — E2E

Coverage code E2E **tidak** di-collect saat ini (istrumentasi Playwright
via `nyc` overkill untuk MVP). Coverage code hanya di unit test — target
**80% branch coverage** untuk `apps/api/src/**/domain/*.ts` dan
`**/service.ts`.

Coverage **fitur** (setiap fitur punya E2E) di-track manual di
[TESTING.md — Attendance Modules E2E — cakupan](./TESTING.md#attendance-modules-e2e--cakupan).

### 10.4 Release sign-off

Sebelum tag `v*.*.*`:

1. Semua **44 E2E spec** pass di CI ✓
2. Semua **UAT P0/P1** manual pass di [UAT-E2E.md](./UAT-E2E.md) ✓
3. Semua **unit test** pass + coverage ≥ 80% branch ✓
4. Load test k6 (bila release major) — p95 endpoint kritis
   `/attendance/clock-in`, `/leave` submit di bawah 500ms ✓
5. Security review — no HIGH+ dari `pnpm audit` yang belum di-ignore
   dengan justifikasi ✓

Sign-off recorded di release note + [CHANGELOG](../CHANGELOG.md) (bila ada).

---

## 11. Coverage prioritization — apa yang perlu E2E?

Framework prioritas — untuk setiap fitur, tanyakan:

1. **Blast radius kalau rusak?**
   - Blocking login / clock-in / approval → **wajib E2E**.
   - Nice-to-have report drilldown → unit + UAT saja.
2. **Sudah di-cover unit?**
   - Ya → E2E hanya happy-path wire-up.
   - Belum → tambah unit dulu, lalu E2E.
3. **Butuh lintas role?**
   - Ya → E2E multi-role (mahal tapi bernilai).
   - Tidak → E2E single role atau API-level.
4. **Butuh integrasi eksternal?**
   - S3 / MinIO → E2E dengan real MinIO service container.
   - SMTP → mock via `EMAIL_TRANSPORT=console`.
   - Webhook → mock via `test-support/webhook-sink` (sudah ada).

### 11.1 Matrix cakupan E2E existing (44 spec)

| Domain              | Spec (jumlah) | Highlight                                                          |
| ------------------- | ------------- | ------------------------------------------------------------------ |
| Auth                | 4             | login, change-password, mfa, mfa-ui                                |
| Session mgmt        | 2             | sessions, sessions-ui                                              |
| Attendance          | 5             | supervisor-view, hr-dashboard, scanner, manual-absence, correction |
| Leave               | 1             | 3-role flow                                                        |
| Overtime            | 1             | submit → approve                                                   |
| Timesheet           | 5             | foundation, workflow, scheduler, reopen, export, export-share      |
| Payroll cutoff      | 2             | attendance, request-types                                          |
| Approvals           | 1             | backlog                                                            |
| Notifications       | 2             | preferences, archive                                               |
| Audit log           | 2             | viewer, export                                                     |
| Company admin       | 2             | api, ui                                                            |
| Analytics           | 1             | dashboard                                                          |
| Reports             | 1             | schedule                                                           |
| DPIA / ROPA         | 2             | dpia, ropa                                                         |
| Data export (DSAR)  | 2             | api, ui                                                            |
| Data erasure        | 2             | api, ui                                                            |
| Retention + consent | 2             | api, ui                                                            |
| Webhook             | 1             | delivery + retry                                                   |
| Security headers    | 1             | CSP + HSTS + nonce                                                 |
| **Total**           | **44**        | ~ 8 menit CI wall time                                             |

Detail per spec: [TESTING.md — Attendance Modules E2E — cakupan](./TESTING.md#attendance-modules-e2e--cakupan).

### 11.2 Yang **belum** di-cover E2E (deliberately)

Lihat [TESTING.md §"Trade-Off dari Ruang Lingkup MVP"](./TESTING.md#trade-off-dari-ruang-lingkup-mvp):

- Clock-in dengan geolocation mock (fase berikutnya).
- Full admin CRUD (user / geofence / shift / holiday) — masih spot-check via UI spec.
- Attachment upload real (butuh MinIO service container).

---

## 12. Template — bikin spec baru

Setiap spec baru mulai dari template ini. Nama file:
`apps/e2e/tests/<domain>-<feature>.spec.ts`.

```typescript
// apps/e2e/tests/<domain>-<feature>.spec.ts
import { expect, test } from '@playwright/test';

import { authenticateApi } from './helpers/api';
import { daysFromToday } from './helpers/dates';
import { loginAs } from './helpers/login';

/**
 * <Fitur> end-to-end.
 *
 * Verifikasi:
 * - <invariant 1>
 * - <invariant 2>
 *
 * Tidak di-tes di sini (di-cover unit / spec lain):
 * - <hal yang di-skip + kenapa>
 */
test.describe('<fitur>', () => {
  test('happy path', async ({ browser }) => {
    const runId = `e2e-<fitur>-${Date.now()}`;

    // ---- Arrange ----
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAs(page, 'employee');

    // ---- Act ----
    await page.goto('/<route>');
    // ... interaksi

    // ---- Assert ----
    await expect(page.getByText(runId)).toBeVisible({ timeout: 10_000 });

    // ---- Cleanup ----
    await ctx.close();
  });

  test('RBAC gating', async ({ playwright }) => {
    for (const role of ['hr', 'admin'] as const) {
      const api = await authenticateApi(playwright, role);
      const res = await api.get('/api/v1/<endpoint>');
      expect(res.status(), `${role} should have access`).toBe(200);
    }
    for (const role of ['employee', 'supervisor'] as const) {
      const api = await authenticateApi(playwright, role);
      const res = await api.get('/api/v1/<endpoint>');
      expect(res.status(), `${role} should be forbidden`).toBe(403);
    }
  });
});
```

---

## 13. Checklist — sebelum PR merge

Untuk setiap PR yang menambah / mengubah fitur:

- [ ] **Unit test** baru menyertai perubahan domain logic (branch coverage ≥ 80%).
- [ ] **E2E spec** happy-path bila fitur cross-role.
- [ ] **UAT scenario** ditambahkan / diperbarui di [UAT-E2E.md](./UAT-E2E.md) bila UI berubah.
- [ ] Selector pakai `getByRole` / `getByLabel` / `getByTestId` — bukan CSS class.
- [ ] Semua assertion pakai `expect(...).toBe*` — tidak ada `waitForTimeout`.
- [ ] Data test di-scoped dengan `runId` unik.
- [ ] Context per role — tidak share page antara role berbeda.
- [ ] RBAC matrix di-tes (200 untuk role allowed, 403 untuk denied, 401 untuk anon).
- [ ] Cleanup: `ctx.close()` di akhir; pre-flight bila perlu.
- [ ] Test lulus 3x berturut lokal: `pnpm e2e --repeat-each=3`.
- [ ] Fitur ada di matrix cakupan di [TESTING.md](./TESTING.md).

---

## 14. Testing modes lanjutan

### 14.1 Accessibility — Axe

Tambahan future:

```typescript
import AxeBuilder from '@axe-core/playwright';

test('a11y: /leave form', async ({ page }) => {
  await loginAs(page, 'employee');
  await page.goto('/leave');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

Belum diadopsi MVP — kandidat setelah suite E2E stabil.

### 14.2 Visual regression — Playwright

```typescript
await expect(page).toHaveScreenshot('leave-form.png', {
  maxDiffPixelRatio: 0.01,
});
```

**Trade-off**: screenshot berubah tiap Chromium bump. Belum diadopsi
untuk MVP — pakai UAT manual saja.

### 14.3 Performance — Playwright + web-vitals

```typescript
const metrics = await page.evaluate(() => {
  return new Promise((res) => {
    new PerformanceObserver((list) => res(list.getEntries())).observe({
      type: 'largest-contentful-paint',
      buffered: true,
    });
  });
});
expect(metrics[0].startTime).toBeLessThan(2500); // LCP < 2.5s
```

Lebih tepat pakai [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) — belum diadopsi.

### 14.4 Load testing — k6

Bukan Playwright. Suite k6 di [`apps/load-test/`](../apps/load-test/README.md).
Dijalankan on-demand via [`load-test.yml`](../.github/workflows/load-test.yml).

---

## 15. Kapan **tidak** menulis test?

Testing yang berlebihan mahal dan mengikis velocity. **Skip test untuk:**

1. **Framework glue.** Router setup, DI wiring — di-tes oleh integration
   framework yang lebih besar (mis. NestJS testing module).
2. **Static content.** Halaman "About Us" tanpa logic bisnis.
3. **Third-party.** Jangan tes bahwa Stripe payment berhasil di
   sandbox — mereka sudah tes.
4. **Perilaku yang jelas dari types.** TypeScript sudah menjamin — pakai
   compile-time daripada runtime test.
5. **Skenario yang tidak realistis.** Bug yang butuh 15 klik dan 3 tab
   berpindah untuk repro biasanya bukan yang user real akan alami.

**Testing hygiene rule of thumb:**

> Setiap test harus **membantu mempercepat** iterasi Anda esok hari.
> Kalau test hanya "biar coverage angka naik", buang.

---

## 16. Bacaan lanjutan

- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Kent C. Dodds — Testing Trophy](https://kentcdodds.com/blog/write-tests)
- [Google Testing Blog — Test Sizes](https://testing.googleblog.com/2010/12/test-sizes.html)
- [Martin Fowler — Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)
- Workpulse docs:
  - [TESTING.md](./TESTING.md) — strategi & arsitektur
  - [UAT-E2E.md](./UAT-E2E.md) — 78 skenario UAT manual
  - [DEMO-USERS.md](./DEMO-USERS.md) — kredensial + fixture
  - [ADR-0015](./ADR/ADR-0015-e2e-test-hygiene.md) — E2E hygiene decision
  - [OPS/CICD.md](./OPS/CICD.md) — pipeline map

---

_Bila menemukan flake, jangan diamkan — buka issue `flaky-test` dan
dokumen kategorisasi di §8 supaya semua tester belajar dari kasus itu._
