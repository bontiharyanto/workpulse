import type { Metadata } from 'next';
import type { JSX } from 'react';

import { SecurityPolicyPanel } from '@/components/features/admin/security/security-policy-panel';
import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = {
  title: 'Kebijakan Keamanan — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/security` — tenant-scoped security policy editor. Currently
 * hosts the MFA enforcement toggle; future security policies (session
 * timeout, password rotation, IP allow-list) land here as additional
 * sections inside `SecurityPolicyPanel` so the URL remains stable.
 *
 * Locked to `SUPER_ADMIN` to keep the tenant's security posture from
 * being relaxed unilaterally by an HR Manager. See ADR-0017 §Revision
 * for the roles rationale.
 */
export default function AdminSecurityPolicyPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['SUPER_ADMIN']}>
        <div className="mx-auto max-w-4xl">
          <PageHeader
            title="Kebijakan Keamanan Tenant"
            description={
              <>
                Atur kebijakan keamanan yang berlaku untuk seluruh tenant Anda. Perubahan berefek{' '}
                <strong>real-time</strong> (dalam ~30 detik) tanpa restart API dan tercatat di audit
                log dengan action <code>SECURITY_POLICY_UPDATED</code>.
              </>
            }
          />
          <SecurityPolicyPanel />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
