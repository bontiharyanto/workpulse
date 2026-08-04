'use client';

import type { AuthenticatedUser } from '@workpulse/shared-types';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { authStore, computeExpiryEpoch } from '@/lib/auth-store';
import { authApi } from '@/lib/api-client';

interface LoginResult {
  /**
   * When true, the caller now holds a pre-MFA session — the FE MUST
   * navigate to `/login/mfa` and complete `POST /auth/mfa/verify`
   * before any other API call will succeed.
   */
  mfaRequired: boolean;
}

interface AuthContextValue {
  user: AuthenticatedUser | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  login: (input: { email: string; password: string }) => Promise<LoginResult>;
  logout: () => Promise<void>;
  /**
   * Applied after a successful `POST /auth/mfa/verify`: swaps the
   * in-memory access token for the fresh MFA-passed one and refreshes
   * the cached user profile so subsequent guards see `mfaPassed=true`.
   */
  completeMfa: (input: { accessToken: string; accessTokenExpiresIn: number }) => Promise<void>;
  /**
   * Refetch the current session shape after an out-of-band mutation
   * (e.g. enrollment confirm rotated the access token). Used by the
   * MFA setup + settings pages to sync the auth store's cached user.
   */
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');

  // Subscribe to the raw auth store so external mutations (e.g. 401 forcing a clear)
  // stay in sync with the React tree.
  useEffect(() => {
    return authStore.subscribe((s) => {
      setUser(s.user);
      setStatus(s.accessToken ? 'authenticated' : 'unauthenticated');
    });
  }, []);

  // On mount: try to hydrate the session using the HttpOnly refresh cookie.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const refreshed = await authApi.refresh();
        if (cancelled) return;
        authStore.set({
          accessToken: refreshed.accessToken,
          expiresAt: computeExpiryEpoch(refreshed.accessTokenExpiresIn),
        });
        const me = await authApi.me();
        if (cancelled) return;
        authStore.set({ user: me });
      } catch {
        if (!cancelled) authStore.clear();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback<AuthContextValue['login']>(async ({ email, password }) => {
    const res = await authApi.login({ email, password });
    authStore.set({
      accessToken: res.accessToken,
      expiresAt: computeExpiryEpoch(res.accessTokenExpiresIn),
      user: res.user,
    });
    return { mfaRequired: res.mfaRequired === true };
  }, []);

  const logout = useCallback<AuthContextValue['logout']>(async () => {
    try {
      await authApi.logout();
    } finally {
      authStore.clear();
    }
  }, []);

  const completeMfa = useCallback<AuthContextValue['completeMfa']>(async ({ accessToken, accessTokenExpiresIn }) => {
    // Swap the in-memory token first so the follow-up /auth/me call
    // carries `mfaPassed=true`. Otherwise the MfaVerifiedGuard would
    // 403 it — /auth/me is @AllowMustChangePassword whitelisted so
    // this works, but keeping the ordering makes the flow
    // race-independent if we tighten the whitelist later.
    authStore.set({
      accessToken,
      expiresAt: computeExpiryEpoch(accessTokenExpiresIn),
    });
    const me = await authApi.me();
    authStore.set({ user: me });
  }, []);

  const refreshMe = useCallback<AuthContextValue['refreshMe']>(async () => {
    const me = await authApi.me();
    authStore.set({ user: me });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, logout, completeMfa, refreshMe }),
    [user, status, login, logout, completeMfa, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
