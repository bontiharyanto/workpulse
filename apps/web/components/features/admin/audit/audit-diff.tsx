'use client';

/**
 * Generic key-by-key JSON diff renderer. Purposefully minimal — no
 * library dependency, no fancy tree traversal for arrays. AuditLog
 * snapshots are shallow objects in practice (`{ status: 'APPROVED',
 * decidedById: 'u-1', ... }`), and a shallow diff catches the
 * interesting cases.
 *
 * Behaviour:
 *   - Every key present in either snapshot gets a row.
 *   - Values are `JSON.stringify`d (compact) for display.
 *   - Rows where `before` and `after` are deep-equal are labelled
 *     "sama" and rendered muted; otherwise "diubah" / "ditambah" /
 *     "dihapus" with color-coded highlights.
 *   - When `before` is null (creation event) all rows render as
 *     "ditambah"; when `after` is null (deletion) all rows render as
 *     "dihapus".
 */
export function AuditDiff({
  before,
  after,
}: {
  before: unknown;
  after: unknown;
}): JSX.Element {
  const beforeObj = isObject(before) ? before : {};
  const afterObj = isObject(after) ? after : {};
  const keys = Array.from(
    new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]),
  ).sort();

  if (keys.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Tidak ada payload before/after untuk baris ini.
      </p>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-[10px] uppercase tracking-widest text-muted-foreground">
          <th className="px-2 py-1 text-left">Field</th>
          <th className="px-2 py-1 text-left">Sebelum</th>
          <th className="px-2 py-1 text-left">Sesudah</th>
          <th className="px-2 py-1 text-left">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {keys.map((k) => {
          const b = beforeObj[k];
          const a = afterObj[k];
          const bMissing = !(k in beforeObj);
          const aMissing = !(k in afterObj);
          const equal = !bMissing && !aMissing && deepEqual(b, a);
          const status = bMissing
            ? 'ditambah'
            : aMissing
              ? 'dihapus'
              : equal
                ? 'sama'
                : 'diubah';
          return (
            <tr key={k} className={STATUS_ROW[status]}>
              <td className="px-2 py-1 font-mono text-[11px]">{k}</td>
              <td className="px-2 py-1 font-mono text-[11px] break-all">
                {bMissing ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  compact(b)
                )}
              </td>
              <td className="px-2 py-1 font-mono text-[11px] break-all">
                {aMissing ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  compact(a)
                )}
              </td>
              <td className="px-2 py-1">
                <span className={STATUS_PILL[status]}>{status}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const STATUS_ROW: Record<string, string> = {
  sama: 'bg-muted/20',
  diubah: 'bg-amber-50',
  ditambah: 'bg-emerald-50',
  dihapus: 'bg-rose-50',
};

const STATUS_PILL: Record<string, string> = {
  sama: 'rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium',
  diubah: 'rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-900',
  ditambah:
    'rounded bg-emerald-200 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900',
  dihapus:
    'rounded bg-rose-200 px-1.5 py-0.5 text-[10px] font-medium text-rose-900',
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function compact(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return `"${v}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
}
