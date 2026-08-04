'use client';

import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { useAuth } from '@/components/providers/auth-provider';

const CHANGE_PASSWORD_PATH = '/change-password';
const MFA_VERIFY_PATH = '/login/mfa';
const MFA_SETUP_PATH = '/setup-mfa';
const CONSENT_PATH = '/consent';

/**
 * Client-side auth gate for `(dashboard)` and `(auth)` change-password pages.
 *
 * Responsibilities (evaluated in priority order — first match wins):
 * 1. Unauthenticated → `/login`.
 * 2. `mustChangePassword=true` → `/change-password`.
 * 3. `mfaEnabled=true && mfaPassed=false` → `/login/mfa` (pre-MFA session).
 * 4. `mfaEnrollmentRequired=true` → `/setup-mfa`. The API bakes the decision
 *    (role + `MFA_ENFORCE_HR_ADMIN`) — we mirror it verbatim so a test-only
 *    `false` override skips this branch consistently on both sides.
 * 5. `pendingConsent != null` → `/consent`. Mirrors the backend
 *    `ConsentAcceptedGuard` — the API refuses every other route.
 *
 * The refresh cookie is HttpOnly, so we cannot inspect it from RSC/middleware
 * unless we forward it and hit `/auth/me` on every request. For MVP we rely
 * on this client gate: if the AuthProvider bootstrap fails to obtain a
 * session, we redirect to `/login`. Server-side gating is planned in
 * ADR-0002 §4. Note that each redirect mirrors an API guard, so a
 * user landing here with a stale client cache still gets a clean 403
 * with a matching code from the backend.
 */
export function RequireAuth({ children }: { children: ReactNode }): JSX.Element | null {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    if (status !== 'authenticated' || !user) return;

    if (user.mustChangePassword === true && pathname !== CHANGE_PASSWORD_PATH) {
      router.replace(CHANGE_PASSWORD_PATH as Route);
      return;
    }
    if (
      user.mfaEnabled === true &&
      user.mfaPassed === false &&
      pathname !== MFA_VERIFY_PATH
    ) {
      router.replace(MFA_VERIFY_PATH as Route);
      return;
    }
    if (
      user.mfaEnrollmentRequired === true &&
      pathname !== MFA_SETUP_PATH &&
      pathname !== CHANGE_PASSWORD_PATH
    ) {
      router.replace(MFA_SETUP_PATH as Route);
      return;
    }
    if (
      user.pendingConsent &&
      pathname !== CONSENT_PATH &&
      pathname !== CHANGE_PASSWORD_PATH &&
      pathname !== MFA_SETUP_PATH &&
      pathname !== MFA_VERIFY_PATH
    ) {
      router.replace(CONSENT_PATH as Route);
    }
  }, [status, user, pathname, router]);

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Memuat sesi...
      </div>
    );
  }

  if (user?.mustChangePassword === true && pathname !== CHANGE_PASSWORD_PATH) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Mengarahkan ke halaman ubah password...
      </div>
    );
  }

  if (
    user?.mfaEnabled === true &&
    user?.mfaPassed === false &&
    pathname !== MFA_VERIFY_PATH
  ) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Mengarahkan ke verifikasi MFA...
      </div>
    );
  }

  if (
    user?.mfaEnrollmentRequired === true &&
    pathname !== MFA_SETUP_PATH &&
    pathname !== CHANGE_PASSWORD_PATH
  ) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Mengarahkan ke pengaturan MFA...
      </div>
    );
  }

  if (
    user?.pendingConsent &&
    pathname !== CONSENT_PATH &&
    pathname !== CHANGE_PASSWORD_PATH &&
    pathname !== MFA_SETUP_PATH &&
    pathname !== MFA_VERIFY_PATH
  ) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Mengarahkan ke halaman persetujuan kebijakan…
      </div>
    );
  }

  return <>{children}</>;
}
