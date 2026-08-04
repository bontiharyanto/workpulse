'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import type {
  BreachCategory,
  BreachDeadlineBucket,
  BreachIncidentListItem,
  BreachIncidentResponse,
  BreachSeverity,
  BreachStatus,
  CreateBreachIncidentInput,
} from '@workpulse/shared-types';

import { ApiError, breachLedgerAdminApi, saveBlob } from '@/lib/api-client';

/**
 * Fase 31g — DPO / HR-facing Breach Notification Ledger.
 *
 * Layout: two-column. Left = list with countdown badge + severity chip.
 * Right = detail with timeline + lifecycle actions + regulator PDF
 * export.
 */
export function BreachLedgerPanel(): JSX.Element {
  const qc = useQueryClient();
  const [banner, setBanner] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useQuery<BreachIncidentListItem[]>({
    queryKey: ['breach', 'list'],
    queryFn: () => breachLedgerAdminApi.list(),
    refetchInterval: 60_000,
  });
  const detail = useQuery<BreachIncidentResponse>({
    enabled: selectedId != null,
    queryKey: ['breach', 'detail', selectedId],
    queryFn: () => breachLedgerAdminApi.detail(selectedId as string),
    refetchInterval: 60_000,
  });

  const showApiError = (err: unknown): void => {
    setBanner(err instanceof ApiError ? err.message : (err as Error).message);
  };

  const invalidate = (): void => {
    qc.invalidateQueries({ queryKey: ['breach'] });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <aside className="space-y-4">
        <CreateForm
          onCreated={(row) => {
            setSelectedId(row.id);
            invalidate();
          }}
          onError={showApiError}
        />
        <IncidentList rows={list.data ?? []} selectedId={selectedId} onSelect={setSelectedId} />
      </aside>
      <main className="space-y-4">
        {banner && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {banner}
          </div>
        )}
        {detail.data ? (
          <IncidentDetail incident={detail.data} onMutated={invalidate} onError={showApiError} />
        ) : (
          <div className="border-border text-muted-foreground rounded-md border border-dashed p-6 text-sm">
            Pilih insiden di kiri untuk melihat detail, timeline, dan tindakan lifecycle.
          </div>
        )}
      </main>
    </div>
  );
}

// -------------------- List --------------------

function IncidentList({
  rows,
  selectedId,
  onSelect,
}: {
  rows: BreachIncidentListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <section className="border-border rounded-md border">
      <div className="border-border bg-muted/40 border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide">
        Incident Register
      </div>
      <ul className="divide-border divide-y">
        {rows.length === 0 && (
          <li className="text-muted-foreground px-3 py-4 text-xs">Belum ada breach incident.</li>
        )}
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={`hover:bg-muted/60 block w-full px-3 py-2 text-left text-xs ${
                r.id === selectedId ? 'bg-muted/60' : ''
              }`}
              onClick={() => onSelect(r.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1 truncate font-medium">{r.title}</div>
                <SeverityChip severity={r.severity} />
              </div>
              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                <span>{r.status}</span>
                <span>·</span>
                <span>{r.category}</span>
                <span>·</span>
                <span>{r.affectedUserCount} subj.</span>
              </div>
              <div className="mt-1">
                <DeadlineBadge deadline={r.deadline} />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// -------------------- Create --------------------

function CreateForm({
  onCreated,
  onError,
}: {
  onCreated: (row: BreachIncidentResponse) => void;
  onError: (e: unknown) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CreateBreachIncidentInput>({
    title: '',
    description: '',
    severity: 'HIGH',
    category: 'CONFIDENTIALITY',
    detectedAt: new Date().toISOString(),
  });

  const create = useMutation({
    mutationFn: () => breachLedgerAdminApi.create(form),
    onSuccess: (row) => {
      setOpen(false);
      setForm({ ...form, title: '', description: '' });
      onCreated(row);
    },
    onError,
  });

  if (!open) {
    return (
      <button
        type="button"
        className="bg-primary text-primary-foreground w-full rounded-md px-3 py-1.5 text-sm font-medium"
        onClick={() => setOpen(true)}
      >
        + Report New Incident
      </button>
    );
  }

  return (
    <form
      className="border-border space-y-2 rounded-md border p-3 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h3 className="text-sm font-semibold">Report Incident</h3>
      <label className="block">
        Judul
        <input
          type="text"
          className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          required
          minLength={4}
          maxLength={200}
        />
      </label>
      <label className="block">
        Deskripsi
        <textarea
          className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={4}
          required
          minLength={20}
          maxLength={5000}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          Severity
          <select
            className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
            value={form.severity}
            onChange={(e) =>
              setForm({
                ...form,
                severity: e.target.value as BreachSeverity,
              })
            }
          >
            {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Kategori
          <select
            className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
            value={form.category}
            onChange={(e) =>
              setForm({
                ...form,
                category: e.target.value as BreachCategory,
              })
            }
          >
            {(['CONFIDENTIALITY', 'INTEGRITY', 'AVAILABILITY', 'MIXED'] as const).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        Detected At (UTC)
        <input
          type="datetime-local"
          className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
          value={toLocalDatetime(form.detectedAt)}
          onChange={(e) =>
            setForm({
              ...form,
              detectedAt: new Date(e.target.value).toISOString(),
            })
          }
          required
        />
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          className="rounded-md border px-3 py-1.5"
          onClick={() => setOpen(false)}
        >
          Batal
        </button>
        <button
          type="submit"
          className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 font-medium disabled:opacity-50"
          disabled={create.isPending}
        >
          {create.isPending ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </form>
  );
}

// -------------------- Detail --------------------

function IncidentDetail({
  incident,
  onMutated,
  onError,
}: {
  incident: BreachIncidentResponse;
  onMutated: () => void;
  onError: (e: unknown) => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [authorityRef, setAuthorityRef] = useState('');
  const [authorityNotifiedAt, setAuthorityNotifiedAt] = useState(new Date().toISOString());
  const [subjectTemplate, setSubjectTemplate] = useState('');
  const [postMortem, setPostMortem] = useState('');
  const [freeNote, setFreeNote] = useState('');

  const contain = useMutation({
    mutationFn: (n: string) => breachLedgerAdminApi.markContained(incident.id, n),
    onSuccess: onMutated,
    onError,
  });
  const notifyAuthority = useMutation({
    mutationFn: () =>
      breachLedgerAdminApi.notifyAuthority(incident.id, {
        notifiedAt: authorityNotifiedAt,
        authorityRef,
        note: note || undefined,
      }),
    onSuccess: onMutated,
    onError,
  });
  const notifySubjects = useMutation({
    mutationFn: () =>
      breachLedgerAdminApi.notifySubjects(incident.id, {
        notifiedAt: new Date().toISOString(),
        template: subjectTemplate,
      }),
    onSuccess: onMutated,
    onError,
  });
  const closeIt = useMutation({
    mutationFn: () =>
      breachLedgerAdminApi.close(incident.id, {
        postMortemSummary: postMortem,
      }),
    onSuccess: onMutated,
    onError,
  });
  const addNote = useMutation({
    mutationFn: () => breachLedgerAdminApi.appendNote(incident.id, { note: freeNote }),
    onSuccess: () => {
      setFreeNote('');
      onMutated();
    },
    onError,
  });

  const canContain = incident.status === 'DETECTED' && !incident.closedAt;
  const canNotifyAuthority = incident.status === 'DETECTED' || incident.status === 'CONTAINED';
  const canNotifySubjects = incident.status === 'NOTIFIED_AUTHORITY';
  const canClose =
    incident.status !== 'CLOSED' &&
    (incident.status === 'NOTIFIED_SUBJECTS' ||
      incident.severity === 'LOW' ||
      incident.status === 'NOTIFIED_AUTHORITY');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-lg font-semibold">{incident.title}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <SeverityChip severity={incident.severity} />
            <span className="border-border rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide">
              {incident.status}
            </span>
            <span className="text-muted-foreground">
              Detected: {incident.detectedAt.slice(0, 19).replace('T', ' ')} UTC
            </span>
          </div>
          <DeadlineBadge deadline={incident.deadline} />
        </div>
        <button
          type="button"
          className="rounded-md border px-3 py-1.5 text-xs"
          onClick={() =>
            breachLedgerAdminApi
              .exportPdf(incident.id)
              .then((b) => saveBlob(b))
              .catch(onError)
          }
        >
          Export PDF (regulator)
        </button>
      </header>

      <section className="border-border space-y-1 rounded-md border p-3 text-sm">
        <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
          Deskripsi
        </h3>
        <p className="whitespace-pre-wrap">{incident.description}</p>
      </section>

      <section className="border-border grid gap-2 rounded-md border p-3 text-xs sm:grid-cols-2">
        <KV label="Kategori" value={incident.category} />
        <KV label="Subjek terdampak" value={String(incident.affectedUserCount)} />
        <KV label="Sistem" value={incident.affectedSystems.join(', ') || '—'} />
        <KV label="Kategori data" value={incident.affectedDataCategories.join(', ') || '—'} />
        <KV label="Reporter" value={incident.reportedByEmail ?? '—'} />
        <KV label="Assignee" value={incident.assignedToEmail ?? '—'} />
        <KV
          label="Occurred"
          value={incident.occurredAt ? incident.occurredAt.slice(0, 19).replace('T', ' ') : '—'}
        />
        <KV label="Detected" value={incident.detectedAt.slice(0, 19).replace('T', ' ')} />
        <KV
          label="Contained"
          value={incident.containedAt ? incident.containedAt.slice(0, 19).replace('T', ' ') : '—'}
        />
        <KV
          label="Authority notified"
          value={
            incident.authorityNotifiedAt
              ? incident.authorityNotifiedAt.slice(0, 19).replace('T', ' ')
              : '—'
          }
        />
        <KV
          label="Subjects notified"
          value={
            incident.subjectsNotifiedAt
              ? incident.subjectsNotifiedAt.slice(0, 19).replace('T', ' ')
              : '—'
          }
        />
        <KV label="Authority ref" value={incident.authorityNotificationRef ?? '—'} />
      </section>

      <section className="border-border space-y-3 rounded-md border p-3">
        <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
          Lifecycle Actions
        </h3>

        {canContain && (
          <div className="space-y-1">
            <label className="text-xs font-medium">Containment note</label>
            <textarea
              className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-xs"
              onClick={() => contain.mutate(note || 'Breach contained')}
              disabled={contain.isPending}
            >
              Mark Contained
            </button>
          </div>
        )}

        {canNotifyAuthority && (
          <div className="space-y-1">
            <label className="text-xs font-medium">Authority notification</label>
            <input
              className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
              placeholder="Nomor referensi Kominfo / regulator"
              value={authorityRef}
              onChange={(e) => setAuthorityRef(e.target.value)}
              required
            />
            <input
              type="datetime-local"
              className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
              value={toLocalDatetime(authorityNotifiedAt)}
              onChange={(e) => setAuthorityNotifiedAt(new Date(e.target.value).toISOString())}
            />
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-xs"
              onClick={() => notifyAuthority.mutate()}
              disabled={notifyAuthority.isPending || authorityRef.length < 1}
            >
              Record Authority Notification
            </button>
          </div>
        )}

        {canNotifySubjects && (
          <div className="space-y-1">
            <label className="text-xs font-medium">Subject notification template (verbatim)</label>
            <textarea
              className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
              rows={3}
              value={subjectTemplate}
              onChange={(e) => setSubjectTemplate(e.target.value)}
            />
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-xs"
              onClick={() => notifySubjects.mutate()}
              disabled={notifySubjects.isPending || subjectTemplate.trim().length < 20}
            >
              Record Subject Notification
            </button>
          </div>
        )}

        {canClose && (
          <div className="space-y-1">
            <label className="text-xs font-medium">Post-mortem summary</label>
            <textarea
              className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
              rows={3}
              value={postMortem}
              onChange={(e) => setPostMortem(e.target.value)}
            />
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-xs"
              onClick={() => closeIt.mutate()}
              disabled={closeIt.isPending || postMortem.trim().length < 20}
            >
              Close Incident
            </button>
          </div>
        )}

        {incident.status !== 'CLOSED' && (
          <div className="space-y-1">
            <label className="text-xs font-medium">Append note</label>
            <textarea
              className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
              rows={2}
              value={freeNote}
              onChange={(e) => setFreeNote(e.target.value)}
            />
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-xs"
              onClick={() => addNote.mutate()}
              disabled={addNote.isPending || freeNote.trim().length < 4}
            >
              Append
            </button>
          </div>
        )}
      </section>

      <section className="border-border rounded-md border">
        <div className="border-border bg-muted/40 border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide">
          Timeline (append-only)
        </div>
        <ol className="divide-border divide-y">
          {incident.timeline.map((ev) => (
            <li key={ev.id} className="space-y-0.5 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground font-mono text-[10px]">
                  {ev.occurredAt.slice(0, 19).replace('T', ' ')} UTC
                </span>
                <span className="border-border rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide">
                  {ev.eventType}
                </span>
              </div>
              <p className="whitespace-pre-wrap">{ev.note}</p>
              {ev.actorEmail && (
                <p className="text-muted-foreground text-[10px]">by {ev.actorEmail}</p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

// -------------------- Bits --------------------

function KV({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function SeverityChip({ severity }: { severity: BreachSeverity }): JSX.Element {
  const colours: Record<BreachSeverity, string> = {
    LOW: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100',
    MEDIUM: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
    HIGH: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100',
    CRITICAL: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${colours[severity]}`}
    >
      {severity}
    </span>
  );
}

function DeadlineBadge({
  deadline,
}: {
  deadline: {
    hoursRemaining: number;
    bucket: BreachDeadlineBucket;
    overdue: boolean;
    active: boolean;
  };
}): JSX.Element {
  if (!deadline.active) {
    return (
      <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[10px]">
        deadline sudah tercapai
      </span>
    );
  }
  const bucketClass: Record<BreachDeadlineBucket, string> = {
    SAFE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100',
    WARNING: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
    CRITICAL: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100',
    OVERDUE: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
  };
  const label = deadline.overdue
    ? `OVERDUE ${Math.abs(deadline.hoursRemaining).toFixed(1)}h`
    : `T-${deadline.hoursRemaining.toFixed(1)}h`;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${bucketClass[deadline.bucket]}`}
    >
      {label} · {deadline.bucket}
    </span>
  );
}

function toLocalDatetime(iso: string): string {
  // trims to `YYYY-MM-DDTHH:mm` in local time for <input type=datetime-local>
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
