import { CompanyConfigAdmin } from '@/components/features/admin/company/company-config-admin';
import { ScannerCursorResetPanel } from '@/components/features/admin/company/scanner-cursor-reset';

export const metadata = { title: 'Admin · Konfigurasi Perusahaan' };

export default function AdminCompanyPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Konfigurasi Perusahaan</h1>
        <p className="text-sm text-muted-foreground">
          Kelola identitas perusahaan dan kebijakan lembur tenant Anda. Perubahan tercatat di
          audit log dengan diff before/after.
        </p>
      </header>
      <CompanyConfigAdmin />
      <ScannerCursorResetPanel />
    </div>
  );
}
