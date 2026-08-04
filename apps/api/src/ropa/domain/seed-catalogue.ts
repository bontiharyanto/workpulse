import type { RopaLegalBasis } from '@prisma/client';

/**
 * Fase 31d — seed catalogue for the ROPA registry.
 *
 * These blueprints describe the six *built-in* processing activities that
 * ship with Workpulse. When a tenant onboards a compliance officer for the
 * first time, they click "Seed defaults" and the service materialises one
 * `RopaActivity` + one `RopaActivityVersion` (DRAFT) per blueprint. HR/DPO
 * then reviews each entry (tenant-specific tweaks: retention, cross-border,
 * security measures) and publishes.
 *
 * Design notes:
 *
 *   - The blueprints are DRAFT-quality starting points — deliberately
 *     conservative on retention and specific enough on legal basis that a
 *     first-time DPO recognises them. They MUST be reviewed before publish;
 *     regulator would reject "generic default" wording.
 *   - Slugs are stable identifiers used by the seed-idempotency check:
 *     re-running seed for a tenant that already has `attendance-tracking`
 *     is a no-op instead of a duplicate-slug error.
 *   - The `dataCategories` / `subjectCategories` / `recipients` values are
 *     free-form strings on the DB side. We standardise the *English* keys
 *     here so exports remain stable; the FE translates them for display.
 */

export interface RopaSeedBlueprint {
  slug: string;
  name: string;
  purpose: string;
  legalBasis: RopaLegalBasis;
  legalBasisDetail: string | null;
  dataCategories: string[];
  subjectCategories: string[];
  recipients: string[];
  retentionPeriod: string;
  crossBorderTransfer: boolean;
  crossBorderDetail: string | null;
  securityMeasures: string;
  notes: string | null;
}

export const ROPA_SEED_BLUEPRINTS: readonly RopaSeedBlueprint[] = [
  {
    slug: 'attendance-tracking',
    name: 'Kehadiran & Geofence Clock-in/out',
    purpose:
      'Mencatat kehadiran karyawan (jam masuk / pulang) dan memverifikasi lokasi kerja sesuai geofence yang ditetapkan perusahaan.',
    legalBasis: 'CONTRACT',
    legalBasisDetail:
      'Pelaksanaan kontrak kerja (Pasal 20 huruf (b) UU 27/2022 PDP) — bukti kehadiran adalah dasar perhitungan upah.',
    dataCategories: ['BASIC_IDENTITY', 'LOCATION', 'DEVICE_METADATA', 'TIMESTAMP'],
    subjectCategories: ['EMPLOYEE'],
    recipients: ['Internal HR', 'Direct supervisor', 'Payroll pipeline (internal)'],
    retentionPeriod:
      'Selama masa kerja aktif + 3 tahun setelah berakhirnya hubungan kerja (UU 13/2003 Pasal 155 jo. PP 78/2015 tentang bukti hubungan kerja).',
    crossBorderTransfer: false,
    crossBorderDetail: null,
    securityMeasures:
      'RBAC per tenant (companyId); enkripsi TLS 1.2+ in-transit; validasi geofence server-side (Haversine); audit log immutable untuk setiap clock-in/out.',
    notes:
      'Koordinat GPS disimpan verbatim untuk pembuktian; presisi dibatasi 7 desimal (± 1cm) untuk mengurangi kebocoran lokasi karyawan di luar shift.',
  },
  {
    slug: 'leave-management',
    name: 'Manajemen Cuti & Izin Sakit',
    purpose:
      'Mengelola pengajuan cuti / izin / sakit, verifikasi surat dokter untuk sakit, dan perhitungan sisa saldo cuti tahunan.',
    legalBasis: 'LEGAL_OBLIGATION',
    legalBasisDetail:
      'UU 13/2003 Pasal 79 (cuti tahunan wajib) & Pasal 93 (upah selama sakit) — pemberi kerja wajib mencatat.',
    dataCategories: ['BASIC_IDENTITY', 'HEALTH_DATA', 'DOCTOR_NOTE_ATTACHMENT', 'DATE_RANGE'],
    subjectCategories: ['EMPLOYEE', 'DEPENDENT'],
    recipients: ['Internal HR', 'Direct supervisor', 'Layanan penyimpanan objek (attachment)'],
    retentionPeriod:
      'Dokumen medis: masa kerja + 2 tahun. Metadata pengajuan cuti: masa kerja + 5 tahun (audit BPJS Ketenagakerjaan).',
    crossBorderTransfer: false,
    crossBorderDetail: null,
    securityMeasures:
      'Surat dokter di-upload via pre-signed URL, disimpan enkripsi at-rest AES-256; hanya HR yang boleh membuka. Kuota cuti dihitung dalam transaksi atomik (`SELECT ... FOR UPDATE`).',
    notes:
      'Data kesehatan (sakit) termasuk data pribadi bersifat spesifik menurut Pasal 4 ayat (2) huruf (b) UU 27/2022 — retensi dan akses lebih ketat dari data lain.',
  },
  {
    slug: 'overtime-management',
    name: 'Pengajuan & Perhitungan Lembur',
    purpose:
      'Mengelola pra-persetujuan lembur (weekday / weekend / hari libur), menghitung upah lembur berdasarkan tarif per perusahaan, dan menyimpan bukti persetujuan.',
    legalBasis: 'LEGAL_OBLIGATION',
    legalBasisDetail:
      'UU 13/2003 Pasal 78 & Kepmen 102/MEN/VI/2004 — perusahaan wajib menyimpan bukti persetujuan lembur dan hitungan upahnya.',
    dataCategories: ['BASIC_IDENTITY', 'EMPLOYMENT', 'FINANCIAL', 'TIMESTAMP'],
    subjectCategories: ['EMPLOYEE'],
    recipients: ['Internal HR', 'Direct supervisor', 'Payroll pipeline (internal)'],
    retentionPeriod: 'Masa kerja + 5 tahun (audit dinas ketenagakerjaan + pajak).',
    crossBorderTransfer: false,
    crossBorderDetail: null,
    securityMeasures:
      'Multi-level approval (supervisor → HR); tarif per user optional; hitungan sisi server; audit log setiap perubahan tarif.',
    notes: null,
  },
  {
    slug: 'timesheet-and-payroll-export',
    name: 'Rekapitulasi Timesheet & Export Payroll',
    purpose:
      'Menghasilkan snapshot bulanan / periodik dari kehadiran, cuti, dan lembur, kemudian meng-export data terverifikasi ke sistem payroll (internal atau vendor).',
    legalBasis: 'CONTRACT',
    legalBasisDetail: 'Pelaksanaan kontrak kerja — perhitungan upah bulanan.',
    dataCategories: ['BASIC_IDENTITY', 'EMPLOYMENT', 'FINANCIAL', 'TIMESTAMP', 'DATE_RANGE'],
    subjectCategories: ['EMPLOYEE'],
    recipients: [
      'Internal HR',
      'Payroll vendor (via signed download URL atau webhook, ditetapkan per tenant)',
    ],
    retentionPeriod:
      'Timesheet snapshot immutable: 10 tahun (memenuhi jangka waktu audit pajak KUP + gugatan ketenagakerjaan). Export blob: 3 tahun setelah publish.',
    crossBorderTransfer: false,
    crossBorderDetail:
      'Jika payroll vendor berada di luar wilayah RI, tenant wajib menambahkan safeguard (kontrak DPA + SCC) dan memperbarui field ini.',
    securityMeasures:
      'Export bytes di-hash SHA-256 & di-audit sebelum di-stream; signed URL time-boxed 24 jam; webhook payload di-tanda-tangan HMAC-SHA256 (Stripe-style).',
    notes: null,
  },
  {
    slug: 'authentication-and-mfa',
    name: 'Autentikasi Pengguna & Multi-factor Authentication',
    purpose:
      'Mengelola login karyawan, sesi aktif, token refresh, dan enrollment MFA (TOTP) untuk peran sensitif (HR / Super Admin).',
    legalBasis: 'LEGITIMATE_INTEREST',
    legalBasisDetail:
      'Kepentingan sah pemberi kerja untuk melindungi sistem HR dari akses tidak berwenang; kepentingan ini tidak melebihi hak subjek data karena data yang diproses minimal (kredensial + audit sesi).',
    dataCategories: [
      'BASIC_IDENTITY',
      'CREDENTIAL_HASH',
      'DEVICE_METADATA',
      'IP_ADDRESS',
      'MFA_SECRET_ENCRYPTED',
    ],
    subjectCategories: ['EMPLOYEE'],
    recipients: ['Internal (tidak dibagikan ke pihak ketiga)'],
    retentionPeriod:
      'Password hash: selama akun aktif. RefreshToken row: 90 hari (auto-purge). MFA backup codes: sampai di-regenerate oleh user. Audit log login: 2 tahun.',
    crossBorderTransfer: false,
    crossBorderDetail: null,
    securityMeasures:
      'Password bcrypt cost 12; MFA secret enkripsi AES-256-GCM (kunci envelope terpisah); rate-limit login (Throttler); audit setiap enroll / disable / verify.',
    notes: null,
  },
  {
    slug: 'outbound-webhook-delivery',
    name: 'Pengiriman Data Keluar (Outbound Webhook)',
    purpose:
      'Mengirim notifikasi peristiwa payroll (export dibuat / share dibagikan / timesheet reopened) ke sistem eksternal yang berlangganan.',
    legalBasis: 'CONTRACT',
    legalBasisDetail:
      'Pelaksanaan kontrak dengan vendor payroll / HRIS pihak ketiga yang bertindak sebagai processor.',
    dataCategories: ['BASIC_IDENTITY', 'EMPLOYMENT', 'FINANCIAL', 'TIMESTAMP', 'PROCESS_METADATA'],
    subjectCategories: ['EMPLOYEE'],
    recipients: [
      'Vendor / sistem eksternal yang di-registrasi oleh HR pada `/admin/webhooks` (dilihat sebagai processor)',
    ],
    retentionPeriod:
      'Delivery log: 90 hari (untuk investigasi kegagalan pengiriman). Endpoint config: sampai dihapus HR.',
    crossBorderTransfer: true,
    crossBorderDetail:
      'Vendor endpoint sering berada di luar wilayah RI (SaaS payroll). Sistem menolak URL private / metadata IP; HR wajib memastikan safeguard (DPA + SCC atau adequacy decision) sebelum mengaktifkan endpoint.',
    securityMeasures:
      'Signature HMAC-SHA256 per pengiriman; secret enkripsi at-rest AES-256-GCM; refuse HTTP di production (HTTPS-only); refuse loopback / private / cloud-metadata IPs (SSRF guard); retry berjadwal 30s→5m→30m→6h.',
    notes:
      'Vendor eksternal harus tercatat sebagai processor terpisah dalam ROPA vendor register jika tenant mengaktifkan modul 33+ (di luar scope Fase 31d).',
  },
] as const;
