'use client';

import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';

import { ApiError, auditAdminApi, saveBlob } from '@/lib/api-client';
import type { AuditLogFilters, AuditLogRow } from '@workpulse/shared-types';

import { KNOWN_AUDIT_ACTIONS, KNOWN_AUDIT_ENTITY_TYPES, externalRouteFor } from './audit-catalog';
import { AuditDiff } from './audit-diff';

/**
 * Audit log viewer with server-side keyset pagination via
 * `useInfiniteQuery`. The filter panel is a small controlled form —
 * changing any input resets the infinite query so pagination starts
 * fresh at page 1.
 *
 * Row expansion inlines the JSON diff below the row it belongs to.
 * We prefer inline over a drawer because compliance workflows tend
 * to compare rows side-by-side (scrolling up/down to find the earlier
 * change) — a drawer forces one-at-a-time inspection.
 */
export function AuditLogViewer(): JSX.Element {
  const [filters, setFilters] = useState<AuditLogFilters>({ limit: 25 });
  const [expanded, setExpanded] = useState<string | null>(null);

  /**
   * Apply a filter patch triggered from a cell click. Always clears
   * `cursor` (jumping to filter X mid-scroll would otherwise carry
   * over stale keyset state from the previous filter set). Also
   * scrolls the filter panel back into view so the user sees what
   * changed — click-to-filter is a spooky-action-at-a-distance
   * UI otherwise.
   */
  const applyFilterPatch = (patch: Partial<AuditLogFilters>): void => {
    setFilters((prev) => ({ ...prev, ...patch, cursor: undefined }));
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // useInfiniteQuery: the queryKey deliberately excludes `cursor` so a
  // page-2 fetch doesn't invalidate the page-1 render. The cursor is
  // supplied via `getNextPageParam` instead.
  const filterKey = useMemo(() => {
    const cleaned = { ...filters, cursor: undefined };
    return JSON.stringify(cleaned);
  }, [filters]);

  const q = useInfiniteQuery({
    queryKey: ['audit-log', filterKey],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      auditAdminApi.list({
        ...filters,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const allRows: AuditLogRow[] = useMemo(
    () => (q.data?.pages ?? []).flatMap((p) => p.rows),
    [q.data],
  );

  /**
   * NDJSON export mutation. Reuses the currently active filter set
   * (minus `cursor`/`limit`) so the file matches what the user is
   * looking at. Server enforces a hard row cap; UI just triggers the
   * download and lets the browser handle the streamed response.
   */
  const exportMutation = useMutation({
    mutationFn: () =>
      auditAdminApi.exportNdjson({
        entityType: filters.entityType,
        entityId: filters.entityId,
        actorId: filters.actorId,
        action: filters.action,
        from: filters.from,
        to: filters.to,
      }),
    onSuccess: (result) => {
      saveBlob(result);
    },
  });

  return (
    <div className="space-y-4">
      <FilterPanel value={filters} onChange={setFilters} disabled={q.isFetching} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          Ekspor akan menghasilkan file <code>.ndjson</code> (satu event per baris). Server
          membatasi hingga 100.000 baris per ekspor — gunakan filter tanggal untuk memecah rentang
          besar.
        </p>
        <button
          type="button"
          className="border-input hover:bg-muted whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending}
        >
          {exportMutation.isPending ? 'Menghasilkan file…' : 'Ekspor NDJSON'}
        </button>
      </div>

      {exportMutation.isError && (
        <p role="alert" className="text-destructive text-xs">
          Gagal ekspor:{' '}
          {exportMutation.error instanceof ApiError
            ? exportMutation.error.message
            : exportMutation.error instanceof Error
              ? exportMutation.error.message
              : 'unknown error'}
        </p>
      )}

      {q.isError && (
        <p role="alert" className="text-destructive text-sm">
          Gagal memuat audit log:{' '}
          {q.error instanceof ApiError
            ? q.error.message
            : q.error instanceof Error
              ? q.error.message
              : 'unknown error'}
        </p>
      )}

      <section className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-[11px] uppercase tracking-widest">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Waktu</th>
              <th className="px-3 py-2 text-left font-medium">Aksi</th>
              <th className="px-3 py-2 text-left font-medium">Entitas</th>
              <th className="px-3 py-2 text-left font-medium">Pelaku</th>
              <th className="px-3 py-2 text-left font-medium">IP</th>
              <th className="w-16 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {allRows.length === 0 && !q.isLoading && (
              <tr>
                <td colSpan={6} className="text-muted-foreground px-3 py-8 text-center text-xs">
                  Tidak ada baris audit yang cocok dengan filter.
                </td>
              </tr>
            )}
            {q.isLoading && (
              <tr>
                <td colSpan={6} className="text-muted-foreground px-3 py-8 text-center text-xs">
                  Memuat…
                </td>
              </tr>
            )}
            {allRows.map((row) => {
              const isExpanded = expanded === row.id;
              const externalRoute = externalRouteFor(row.entityType, row.entityId);
              return (
                <Fragment key={row.id}>
                  <tr className={isExpanded ? 'bg-muted/30' : 'hover:bg-muted/20'}>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <FilterChip
                        label={row.action}
                        title={`Filter berdasarkan aksi ${row.action}`}
                        onClick={() => applyFilterPatch({ action: row.action })}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex items-center gap-1">
                        <FilterChip
                          label={row.entityType}
                          bold
                          title={`Filter berdasarkan tipe entitas ${row.entityType}`}
                          onClick={() =>
                            applyFilterPatch({
                              entityType: row.entityType,
                              entityId: undefined,
                            })
                          }
                        />
                        {externalRoute && (
                          <Link
                            href={externalRoute as Route}
                            className="text-muted-foreground hover:text-foreground text-[10px]"
                            title={`Buka halaman ${row.entityType}`}
                          >
                            ↗
                          </Link>
                        )}
                      </div>
                      <FilterChip
                        label={row.entityId}
                        mono
                        title={`Filter berdasarkan entitas ${row.entityType} · ${row.entityId}`}
                        onClick={() =>
                          applyFilterPatch({
                            entityType: row.entityType,
                            entityId: row.entityId,
                          })
                        }
                        variant="muted"
                      />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <FilterChip
                        label={row.actorName ?? row.actorId}
                        bold
                        title={`Filter berdasarkan pelaku ${row.actorName ?? row.actorId}`}
                        onClick={() => applyFilterPatch({ actorId: row.actorId })}
                      />
                      <div className="text-muted-foreground text-[11px]">{row.actorEmail}</div>
                    </td>
                    <td className="text-muted-foreground px-3 py-2 font-mono text-[11px]">
                      {row.ip ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
                        onClick={() => setExpanded((cur) => (cur === row.id ? null : row.id))}
                      >
                        {isExpanded ? 'Tutup' : 'Diff'}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-muted/10">
                      <td colSpan={6} className="px-3 py-3">
                        <AuditDiff before={row.beforeJson ?? null} after={row.afterJson ?? null} />
                        {row.userAgent && (
                          <p className="text-muted-foreground mt-2 truncate text-[10px]">
                            <span className="font-medium">UA:</span> {row.userAgent}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {allRows.length > 0 && `${allRows.length} baris dimuat`}
        </span>
        {q.hasNextPage && (
          <button
            type="button"
            className="border-input hover:bg-muted rounded-md border px-3 py-2 text-xs font-medium disabled:opacity-50"
            onClick={() => void q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
          >
            {q.isFetchingNextPage ? 'Memuat…' : 'Muat lebih banyak'}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter panel
// ---------------------------------------------------------------------------

interface FilterPanelProps {
  value: AuditLogFilters;
  onChange: (next: AuditLogFilters) => void;
  disabled: boolean;
}

function FilterPanel({ value, onChange, disabled }: FilterPanelProps): JSX.Element {
  const patch = (next: Partial<AuditLogFilters>): void => {
    onChange({ ...value, ...next, cursor: undefined });
  };
  return (
    <section className="bg-muted/20 grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4">
      <datalist id="audit-entity-types">
        {KNOWN_AUDIT_ENTITY_TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="audit-actions">
        {KNOWN_AUDIT_ACTIONS.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
      <Field label="Entitas (entityType)">
        <input
          type="text"
          placeholder="LeaveRequest"
          list="audit-entity-types"
          value={value.entityType ?? ''}
          onChange={(e) => patch({ entityType: e.target.value || undefined })}
          disabled={disabled}
          className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-xs"
        />
      </Field>
      <Field label="Aksi">
        <input
          type="text"
          placeholder="LEAVE_REQUEST_APPROVED"
          list="audit-actions"
          value={value.action ?? ''}
          onChange={(e) => patch({ action: e.target.value || undefined })}
          disabled={disabled}
          className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-xs"
        />
      </Field>
      <Field label="Actor ID">
        <input
          type="text"
          placeholder="u-…"
          value={value.actorId ?? ''}
          onChange={(e) => patch({ actorId: e.target.value || undefined })}
          disabled={disabled}
          className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-xs"
        />
      </Field>
      <Field label="Entity ID">
        <input
          type="text"
          placeholder="lr-…"
          value={value.entityId ?? ''}
          onChange={(e) => patch({ entityId: e.target.value || undefined })}
          disabled={disabled}
          className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-xs"
        />
      </Field>
      <Field label="Dari (createdAt ≥)">
        <input
          type="datetime-local"
          value={dateForInput(value.from)}
          onChange={(e) =>
            patch({ from: e.target.value ? new Date(e.target.value).toISOString() : undefined })
          }
          disabled={disabled}
          className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-xs"
        />
      </Field>
      <Field label="Sampai (createdAt ≤)">
        <input
          type="datetime-local"
          value={dateForInput(value.to)}
          onChange={(e) =>
            patch({ to: e.target.value ? new Date(e.target.value).toISOString() : undefined })
          }
          disabled={disabled}
          className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-xs"
        />
      </Field>
      <div className="flex items-end justify-end sm:col-span-2 lg:col-span-2">
        <button
          type="button"
          className="border-input hover:bg-muted rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          onClick={() => onChange({ limit: value.limit ?? 25 })}
          disabled={disabled}
        >
          Reset filter
        </button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground text-[10px] uppercase tracking-widest">{label}</span>
      {children}
    </label>
  );
}

/**
 * A cell value that doubles as a filter-apply button. Renders as a
 * text-styled control (not a pill) because a full pill on every
 * cell would visually swamp the table — we want the "clickability"
 * signal to appear only on hover.
 */
function FilterChip({
  label,
  title,
  onClick,
  bold,
  mono,
  variant = 'default',
}: {
  label: string;
  title: string;
  onClick: () => void;
  bold?: boolean;
  mono?: boolean;
  variant?: 'default' | 'muted';
}): JSX.Element {
  const cls = [
    'inline-block cursor-pointer text-left underline-offset-2 hover:underline focus:underline focus:outline-none',
    bold ? 'font-medium' : '',
    mono ? 'font-mono text-[11px]' : '',
    variant === 'muted' ? 'text-muted-foreground' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} title={title} onClick={onClick}>
      {label}
    </button>
  );
}

function dateForInput(iso: string | undefined): string {
  if (!iso) return '';
  // `<input type="datetime-local">` wants `YYYY-MM-DDTHH:mm` in local
  // time — the ISO stored is UTC. Convert once.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('id-ID', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
