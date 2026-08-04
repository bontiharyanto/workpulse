import type { AuthenticatedUser } from '@workpulse/shared-types';

/**
 * In-memory access-token store shared across the client bundle.
 *
 * Rationale: keeping the access token out of localStorage/sessionStorage mitigates
 * XSS token theft. Refresh happens via the HttpOnly `wp_refresh` cookie so the
 * token can be re-obtained after a page reload (see AuthProvider bootstrap).
 */

interface AuthState {
  accessToken: string | null;
  expiresAt: number | null; // epoch ms
  user: AuthenticatedUser | null;
}

let state: AuthState = { accessToken: null, expiresAt: null, user: null };
const listeners = new Set<(s: AuthState) => void>();

function emit(): void {
  for (const l of listeners) l(state);
}

export const authStore = {
  get(): AuthState {
    return state;
  },
  set(next: Partial<AuthState>): void {
    state = { ...state, ...next };
    emit();
  },
  clear(): void {
    state = { accessToken: null, expiresAt: null, user: null };
    emit();
  },
  subscribe(listener: (s: AuthState) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function computeExpiryEpoch(expiresInSeconds: number): number {
  // Refresh 60s before actual expiry to avoid mid-request expirations.
  const skewMs = 60_000;
  return Date.now() + expiresInSeconds * 1000 - skewMs;
}
