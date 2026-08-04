import { AuditLogViewer } from '@/components/features/admin/audit/audit-log-viewer';

export const metadata = { title: 'Admin · Audit Log' };

export default function AdminAuditLogPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground text-sm">
          Riwayat perubahan sensitif pada tenant Anda — approval cuti / lembur, konfigurasi
          perusahaan, tanda absen manual, reset cursor scanner, dsb. Baris append-only, tidak dapat
          dihapus atau diedit.
        </p>
      </header>
      <AuditLogViewer />
    </div>
  );
}
