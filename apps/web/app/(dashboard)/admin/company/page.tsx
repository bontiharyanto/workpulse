import type { JSX } from 'react';

import { CompanyConfigAdmin } from '@/components/features/admin/company/company-config-admin';
import { ScannerCursorResetPanel } from '@/components/features/admin/company/scanner-cursor-reset';
import { PageHeader } from '@/components/layout/page-header';

export const metadata = { title: 'Admin · Konfigurasi Perusahaan' };

export default function AdminCompanyPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Konfigurasi Perusahaan"
        description="Kelola identitas perusahaan dan kebijakan lembur tenant Anda. Perubahan tercatat di audit log dengan diff before/after."
      />
      <div className="space-y-6">
        <CompanyConfigAdmin />
        <ScannerCursorResetPanel />
      </div>
    </div>
  );
}
