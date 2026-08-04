'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type {
  DpiaAssessmentListItem,
  DpiaAssessmentResponse,
  DpiaRiskLevel,
  DpiaStatus,
} from '@workpulse/shared-types';

import { ApiError, dpiaAdminApi, ropaAdminApi, saveBlob } from '@/lib/api-client';

const STATUS_BADGE: Record<DpiaStatus, { label: string; className: string }> = {
  DRAFT: {
    label: 'Draft',
    className:
      'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
  },
  REVIEW: {
    label: 'Review',
    className: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100',
  },
  APPROVED: {
    label: 'Approved',
    className:
      'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  },
  ARCHIVED: {
    label: 'Archived',
    className: 'bg-muted text-muted-foreground',
  },
};

const LEVEL_BADGE: Record<DpiaRiskLevel, string> = {
  LOW: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  MEDIUM:
    'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
  HIGH: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100',
  CRITICAL: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100',
};

const ERROR_COPY: Record<string, string> = {
  DPIA_NOT_EDITABLE: 'DPIA sudah tidak DRAFT — kembalikan ke draft dulu.',
  DPIA_NOT_IN_REVIEW: 'Hanya DPIA berstatus REVIEW yang dapat di-approve.',
  DPIA_HAS_NO_RISK_ITEMS: 'Tambahkan minimal satu risiko sebelum approve.',
  DPIA_RESIDUAL_EXCEEDS_INHERENT:
    'Residual tidak boleh lebih besar dari inherent — mitigasi tidak bisa memperburuk risiko.',
  DPIA_RISK_AXIS_OUT_OF_RANGE:
    'Likelihood/impact harus bilangan 1..5.',
  ROPA_ACTIVITY_NOT_FOUND: 'Aktivitas ROPA tidak ditemukan di tenant Anda.',
};

/**
 * Fase 31e — main DPIA registry panel.
 *
 * Layout: list on the left, selected assessment detail on the right.
 * Rendering both from a single component keeps the state-transitions
 * (approve → refresh list) simple without prop-drilling.
 */
export function DpiaRegistryPanel(): JSX.Element {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const list = useQuery<DpiaAssessmentListItem[]>({
    queryKey: ['dpia', 'list'],
    queryFn: () => dpiaAdminApi.list(),
    staleTime: 30_000,
  });

  const detail = useQuery<DpiaAssessmentResponse>({
    queryKey: ['dpia', 'detail', selectedId],
    queryFn: () => dpiaAdminApi.detail(selectedId!),
    enabled: !!selectedId,
    staleTime: 15_000,
  });

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['dpia'] });
  };

  const showApiError = (err: unknown): void => {
    if (err instanceof ApiError) {
      setBanner(ERROR_COPY[err.code] ?? err.message);
    } else {
      setBanner((err as Error).message);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Assessment</h2>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:opacity-90"
            onClick={() => {
              setShowCreate((v) => !v);
              setBanner(null);
            }}
          >
            {showCreate ? 'Batal' : '+ DPIA baru'}
          </button>
        </div>
        {banner && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {banner}
          </div>
        )}
        {showCreate && (
          <CreateForm
            onCreated={(id) => {
              setShowCreate(false);
              setSelectedId(id);
              invalidate();
            }}
            onError={showApiError}
          />
        )}
        <ul className="space-y-2">
          {list.isLoading && (
            <li className="text-sm text-muted-foreground">Memuat…</li>
          )}
          {list.data?.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className={`w-full rounded-md border p-3 text-left transition hover:border-primary ${
                  row.id === selectedId ? 'border-primary bg-muted/40' : 'border-border'
                }`}
                onClick={() => setSelectedId(row.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium">{row.title}</span>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[row.status].className}`}
                  >
                    {STATUS_BADGE[row.status].label}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {row.ropaActivityName ?? row.ropaActivitySlug}
                </div>
                <div className="mt-2 flex items-center gap-2 text-[11px]">
                  <span
                    className={`rounded px-1.5 py-0.5 font-medium ${LEVEL_BADGE[row.summaryResidualLevel]}`}
                  >
                    residual: {row.summaryResidualLevel}
                  </span>
                  <span className="text-muted-foreground">
                    {row.riskItemCount} risk item
                  </span>
                </div>
              </button>
            </li>
          ))}
          {list.data && list.data.length === 0 && !showCreate && (
            <li className="text-sm text-muted-foreground">
              Belum ada DPIA. Klik "+ DPIA baru" untuk memulai.
            </li>
          )}
        </ul>
      </section>

      <section className="space-y-3">
        {!selectedId && (
          <p className="text-sm text-muted-foreground">
            Pilih DPIA di panel kiri untuk melihat register risiko.
          </p>
        )}
        {detail.data && (
          <DpiaDetail
            data={detail.data}
            onError={showApiError}
            onChanged={invalidate}
          />
        )}
      </section>
    </div>
  );
}

// -------- Create form --------

function CreateForm({
  onCreated,
  onError,
}: {
  onCreated: (id: string) => void;
  onError: (err: unknown) => void;
}): JSX.Element {
  const activities = useQuery({
    queryKey: ['ropa', 'activities'],
    queryFn: () => ropaAdminApi.list(),
  });
  const [ropaActivityId, setRopaActivityId] = useState('');
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [necessity, setNecessity] = useState('');

  const create = useMutation({
    mutationFn: () =>
      dpiaAdminApi.create({
        ropaActivityId,
        title: title.trim(),
        scope: scope.trim(),
        necessity: necessity.trim(),
      }),
    onSuccess: (res) => onCreated(res.id),
    onError,
  });

  return (
    <form
      className="space-y-3 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div>
        <label className="mb-1 block text-xs font-medium">Aktivitas ROPA</label>
        <select
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          value={ropaActivityId}
          onChange={(e) => setRopaActivityId(e.target.value)}
          required
        >
          <option value="">— pilih —</option>
          {activities.data?.map((a) => (
            <option key={a.activityId} value={a.activityId}>
              {a.currentVersion?.name ?? a.slug} ({a.slug})
            </option>
          ))}
        </select>
      </div>
      <TextInput label="Judul DPIA" value={title} onChange={setTitle} minLength={4} />
      <TextArea label="Scope (ruang lingkup)" value={scope} onChange={setScope} minLength={20} />
      <TextArea
        label="Necessity (justifikasi)"
        value={necessity}
        onChange={setNecessity}
        minLength={20}
      />
      <button
        type="submit"
        disabled={create.isPending}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {create.isPending ? 'Membuat…' : 'Buat DPIA'}
      </button>
    </form>
  );
}

// -------- Detail --------

function DpiaDetail({
  data,
  onError,
  onChanged,
}: {
  data: DpiaAssessmentResponse;
  onError: (err: unknown) => void;
  onChanged: () => void;
}): JSX.Element {
  const editable = data.status === 'DRAFT';
  const submit = useMutation({
    mutationFn: () => dpiaAdminApi.submitReview(data.id),
    onSuccess: onChanged,
    onError,
  });
  const back = useMutation({
    mutationFn: () => dpiaAdminApi.returnToDraft(data.id),
    onSuccess: onChanged,
    onError,
  });
  const approve = useMutation({
    mutationFn: () => dpiaAdminApi.approve(data.id),
    onSuccess: onChanged,
    onError,
  });
  const download = useMutation({
    mutationFn: async () => {
      const blob = await dpiaAdminApi.exportPdf(data.id);
      saveBlob(blob);
    },
    onError,
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{data.title}</h3>
          <p className="text-xs text-muted-foreground">
            Status: <strong>{data.status}</strong> · residual tertinggi:{' '}
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${LEVEL_BADGE[data.summaryResidualLevel]}`}
            >
              {data.summaryResidualLevel}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.status === 'DRAFT' && (
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-xs"
              onClick={() => submit.mutate()}
              disabled={submit.isPending}
            >
              Submit review
            </button>
          )}
          {data.status === 'REVIEW' && (
            <>
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-xs"
                onClick={() => back.mutate()}
                disabled={back.isPending}
              >
                Kembalikan ke draft
              </button>
              <button
                type="button"
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white"
                onClick={() => approve.mutate()}
                disabled={approve.isPending}
              >
                Approve
              </button>
            </>
          )}
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-xs"
            onClick={() => download.mutate()}
            disabled={download.isPending}
          >
            Export PDF
          </button>
        </div>
      </header>

      <section className="grid gap-3">
        <Panel label="Scope">{data.scope}</Panel>
        <Panel label="Necessity">{data.necessity}</Panel>
        {data.dpoOpinion && <Panel label="DPO opinion">{data.dpoOpinion}</Panel>}
        {data.conclusion && <Panel label="Kesimpulan">{data.conclusion}</Panel>}
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">
          Risk register ({data.riskItems.length})
        </h4>
        <RiskTable rows={data.riskItems} />
        {editable && (
          <AddRiskForm
            assessmentId={data.id}
            onChanged={onChanged}
            onError={onError}
          />
        )}
      </section>
    </div>
  );
}

function Panel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 whitespace-pre-wrap text-sm">{children}</div>
    </div>
  );
}

function RiskTable({
  rows,
}: {
  rows: DpiaAssessmentResponse['riskItems'];
}): JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">Belum ada risiko.</p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="px-2 py-1">#</th>
            <th className="px-2 py-1">Risiko</th>
            <th className="px-2 py-1">Inherent</th>
            <th className="px-2 py-1">Mitigasi</th>
            <th className="px-2 py-1">Residual</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="px-2 py-1 font-mono">{r.ordinal}</td>
              <td className="px-2 py-1">
                <div className="font-medium">{r.title}</div>
                <div className="text-muted-foreground">{r.description}</div>
              </td>
              <td className="px-2 py-1">
                <span
                  className={`inline-block rounded px-1.5 py-0.5 font-medium ${LEVEL_BADGE[r.inherentLevel]}`}
                >
                  {r.inherentLevel}
                </span>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  L{r.likelihood}×I{r.impact}={r.inherentScore}
                </div>
              </td>
              <td className="px-2 py-1 whitespace-pre-wrap">{r.mitigations}</td>
              <td className="px-2 py-1">
                <span
                  className={`inline-block rounded px-1.5 py-0.5 font-medium ${LEVEL_BADGE[r.residualLevel]}`}
                >
                  {r.residualLevel}
                </span>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  L{r.residualLikelihood}×I{r.residualImpact}={r.residualScore}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddRiskForm({
  assessmentId,
  onChanged,
  onError,
}: {
  assessmentId: string;
  onChanged: () => void;
  onError: (err: unknown) => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [likelihood, setLikelihood] = useState(3);
  const [impact, setImpact] = useState(3);
  const [mitigations, setMitigations] = useState('');
  const [resLik, setResLik] = useState(2);
  const [resImp, setResImp] = useState(2);

  const add = useMutation({
    mutationFn: () =>
      dpiaAdminApi.addRisk(assessmentId, {
        title: title.trim(),
        description: description.trim(),
        likelihood,
        impact,
        mitigations: mitigations.trim(),
        residualLikelihood: resLik,
        residualImpact: resImp,
      }),
    onSuccess: () => {
      setTitle('');
      setDescription('');
      setMitigations('');
      onChanged();
    },
    onError,
  });

  return (
    <form
      className="space-y-2 rounded-md border border-dashed border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Tambah risiko
      </div>
      <TextInput label="Judul risiko" value={title} onChange={setTitle} minLength={4} />
      <TextArea
        label="Deskripsi"
        value={description}
        onChange={setDescription}
        minLength={10}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Inherent likelihood (1..5)" value={likelihood} onChange={setLikelihood} />
        <NumberField label="Inherent impact (1..5)" value={impact} onChange={setImpact} />
      </div>
      <TextArea label="Mitigasi" value={mitigations} onChange={setMitigations} minLength={10} />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Residual likelihood (≤ inherent)"
          value={resLik}
          onChange={setResLik}
        />
        <NumberField
          label="Residual impact (≤ inherent)"
          value={resImp}
          onChange={setResImp}
        />
      </div>
      <button
        type="submit"
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        disabled={add.isPending}
      >
        {add.isPending ? 'Menambah…' : 'Tambah risiko'}
      </button>
    </form>
  );
}

function TextInput({
  label,
  value,
  onChange,
  minLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  minLength?: number;
}): JSX.Element {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      <input
        type="text"
        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        minLength={minLength}
        required
      />
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  minLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  minLength?: number;
}): JSX.Element {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      <textarea
        className="min-h-[80px] w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        minLength={minLength}
        required
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      <input
        type="number"
        min={1}
        max={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
      />
    </div>
  );
}
