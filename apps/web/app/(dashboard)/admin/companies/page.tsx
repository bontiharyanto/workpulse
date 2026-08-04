import { RequireRole } from '@/components/features/auth/require-role';
import { CompanyAdmin } from '@/components/features/admin/companies/company-admin';

export const metadata = { title: 'Admin · Tenant' };

/**
 * SUPER_ADMIN-only route. We gate the inner content with `RequireRole`
 * even though this route sits under `(dashboard)/admin/*` — the shared
 * layout allows HR_MANAGER, so this second guard is what actually
 * enforces the cross-tenant boundary.
 */
export default function CompanyAdminPage(): JSX.Element {
  return (
    <RequireRole roles={['SUPER_ADMIN']}>
      <CompanyAdmin />
    </RequireRole>
  );
}
