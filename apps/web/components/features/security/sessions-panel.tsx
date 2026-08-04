'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@workpulse/shared-types';
import { useState } from 'react';

import { ApiError, sessionsApi } from '@/lib/api-client';
import { authStore } from '@/lib/auth-store';

const ERROR_COPY: Record<string, string> = {
  SESSION_NOT_FOUND: 'Sesi tidak ditemukan atau sudah tidak aktif.',
  SESSION_ALREADY_REVOKED: 'Sesi ini sudah dinonaktifkan sebelumnya.',
  THROTTLED: 'Terlalu banyak percobaan. Coba lagi sebentar.',
};

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * Self-service session management. Reads every ACTIVE `RefreshToken`
 * for the caller, marks the current one via the refresh-cookie hash
 * comparison performed server-side, and offers:
 *
 * - Per-row **Logout device** — revokes that specific `RefreshToken`.
 *   If the row is the caller's own, we tear down the FE auth state
 *   and bounce back to `/login` (the refresh cookie is now dead).
 * - **Logout semua sesi lain** — sweeps every ACTIVE row EXCEPT the
 *   caller's current one, so the user stays signed in on the tab
 *   they're operating from.
 *
 * The row copy is deliberately human-friendly (parsed user-agent +
 * relative "sekarang" badge on the current session) so a non-technical
 * user can still recognise "my laptop at home" vs "an old phone I
 * lost".
 */
export function SessionsPanel(): JSX.Element {
  const qc = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => sessionsApi.list(),
    staleTime: 15_000,
  });

  const revokeMutation = useMutation({
    mutationFn: async (row: Session) => {
      await sessionsApi.revoke(row.id);
      return row;
    },
    onSuccess: async (row) => {
      setError(null);
      setConfirmingId(null);
      if (row.isCurrent) {
        // The refresh cookie backing this tab is dead — every
        // subsequent /auth/refresh will 401. Clear the in-memory
        // store and hand control to /login.
        authStore.clear();
        window.location.assign('/login');
        return;
      }
      await qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err: unknown) => {
      setConfirmingId(null);
      if (err instanceof ApiError) {
        setError(ERROR_COPY[err.code] ?? err.message);
      } else {
        setError('Tidak dapat menonaktifkan sesi.');
      }
    },
  });

  const revokeOthersMutation = useMutation({
    mutationFn: () => sessionsApi.revokeOthers(),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setError(ERROR_COPY[err.code] ?? err.message);
      } else {
        setError('Tidak dapat menonaktifkan sesi.');
      }
    },
  });

  if (sessions.isLoading) {
    return <p className="text-sm text-muted-foreground">Memuat sesi...</p>;
  }
  if (sessions.error || !sessions.data) {
    return (
      <p className="text-sm text-destructive">Tidak dapat memuat sesi aktif.</p>
    );
  }

  const rows = sessions.data;
  const otherCount = rows.filter((r) => !r.isCurrent).length;

  return (
    <section
      className="space-y-3"
      data-testid="sessions-panel"
      aria-labelledby="sessions-heading"
    >
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2
            id="sessions-heading"
            className="text-lg font-semibold tracking-tight"
          >
            Sesi aktif
          </h2>
          <p className="text-sm text-muted-foreground">
            Daftar perangkat yang saat ini login ke akun Anda. Nonaktifkan
            sesi yang tidak Anda kenali.
          </p>
        </div>
        <button
          type="button"
          onClick={() => revokeOthersMutation.mutate()}
          disabled={revokeOthersMutation.isPending || otherCount === 0}
          data-testid="sessions-revoke-others"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          {revokeOthersMutation.isPending
            ? 'Menonaktifkan...'
            : `Logout semua sesi lain${otherCount > 0 ? ` (${otherCount})` : ''}`}
        </button>
      </div>

      {revokeOthersMutation.isSuccess && (
        <p
          role="status"
          className="rounded-md border border-emerald-300/60 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        >
          {revokeOthersMutation.data.revokedCount === 0
            ? 'Tidak ada sesi lain yang aktif.'
            : `${revokeOthersMutation.data.revokedCount} sesi lain berhasil dinonaktifkan.`}
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            data-testid="session-row"
            data-session-id={row.id}
            data-current={row.isCurrent || undefined}
            className={
              row.isCurrent
                ? 'flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/60 bg-primary/5 p-3'
                : 'flex flex-wrap items-center justify-between gap-3 rounded-md border border-input p-3'
            }
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{describeDevice(row.userAgent)}</p>
                {row.isCurrent && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                    Sesi ini
                  </span>
                )}
                {row.mfaVerified && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-900">
                    MFA
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {row.ip ?? 'IP tidak tersedia'} · Login{' '}
                {formatDate(row.createdAt)} · Kedaluwarsa{' '}
                {formatDate(row.expiresAt)}
              </p>
            </div>

            {confirmingId === row.id ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => revokeMutation.mutate(row)}
                  disabled={revokeMutation.isPending}
                  data-testid="session-revoke-confirm"
                  className="rounded-md bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                >
                  {revokeMutation.isPending ? 'Menonaktifkan...' : 'Ya, nonaktifkan'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingId(null)}
                  className="rounded-md border border-input px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  Batal
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingId(row.id)}
                data-testid="session-revoke-btn"
                className="rounded-md border border-destructive/40 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                Logout {row.isCurrent ? 'perangkat ini' : 'perangkat'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Turn a raw user-agent into a short, humane label. We intentionally
 * do NOT ship a full UA parser — a heuristic on the most common
 * substrings is enough for a non-technical user to recognise their
 * own devices, and it keeps the bundle small.
 */
function describeDevice(ua: string | null): string {
  if (!ua) return 'Perangkat tidak dikenal';
  const os = matchFirst(ua, [
    [/windows nt/i, 'Windows'],
    [/mac os x|macintosh/i, 'macOS'],
    [/android/i, 'Android'],
    [/iphone|ipad|ios/i, 'iOS'],
    [/linux/i, 'Linux'],
  ]);
  const browser = matchFirst(ua, [
    [/edg\//i, 'Edge'],
    [/chrome\//i, 'Chrome'],
    [/firefox\//i, 'Firefox'],
    [/safari\//i, 'Safari'],
    [/curl|node|axios/i, 'API client'],
  ]);
  if (os && browser) return `${browser} · ${os}`;
  if (os) return os;
  if (browser) return browser;
  return ua.length > 60 ? `${ua.slice(0, 60)}…` : ua;
}

function matchFirst(
  input: string,
  patterns: readonly [RegExp, string][],
): string | null {
  for (const [re, label] of patterns) {
    if (re.test(input)) return label;
  }
  return null;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', DATE_FORMAT);
  } catch {
    return iso;
  }
}
