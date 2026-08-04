import type { JSX } from 'react';

import { AuditLogViewer } from '@/components/features/admin/audit/audit-log-viewer';
import { PageHeader } from '@/components/layout/page-header';

export const metadata = { title: 'Admin · Audit Log' };

export default function AdminAuditLogPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Audit Log"
        description="Riwayat perubahan sensitif pada tenant Anda — approval cuti / lembur, konfigurasi perusahaan, tanda absen manual, reset cursor scanner, dsb. Baris append-only, tidak dapat dihapus atau diedit."
      />
      <AuditLogViewer />
    </div>
  );
}
