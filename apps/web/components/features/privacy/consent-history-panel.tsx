'use client';

import { useQuery } from '@tanstack/react-query';

import { consentApi } from '@/lib/api-client';

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * Read-only ledger of every privacy-policy version the user has
 * accepted (Fase 31c). Proof-of-consent surface — users can
 * screenshot / export for their own records.
 *
 * Also renders the current active policy body so the user can
 * refresh their memory without having to re-accept it.
 */
export function ConsentHistoryPanel(): JSX.Element {
  const current = useQuery({
    queryKey: ['privacy-policy-current'],
    queryFn: () => consentApi.current(),
    staleTime: 60_000,
  });

  const history = useQuery({
    queryKey: ['privacy-policy-history'],
    queryFn: () => consentApi.history(),
    staleTime: 30_000,
  });

  return (
    <section
      aria-labelledby="consent-heading"
      className="space-y-4 rounded-lg border border-border bg-card p-6"
    >
      <div className="space-y-1">
        <h2 id="consent-heading" className="text-lg font-semibold">
          Persetujuan kebijakan privasi
        </h2>
        <p className="text-sm text-muted-foreground">
          Riwayat versi kebijakan yang telah Anda terima. Diperbarui setiap
          kali perusahaan menerbitkan versi baru.
        </p>
      </div>

      {current.data && (
        <details className="rounded-md border border-input p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Lihat kebijakan aktif — v{current.data.version} ·{' '}
            {current.data.title}
          </summary>
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
            {current.data.body}
          </pre>
        </details>
      )}

      {history.isLoading ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground"
        >
          Memuat riwayat…
        </div>
      ) : history.data && history.data.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {history.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {c.policyTitle}
                  <span className="ml-2 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    v{c.policyVersion}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Diterima{' '}
                  {new Date(c.acceptedAt).toLocaleString('id-ID', DATE_FORMAT)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          Belum ada persetujuan yang tercatat.
        </div>
      )}
    </section>
  );
}
