/**
 * OPS-7 — Pure functions for tenant usage snapshot maths.
 *
 * The heavy lifting is the Prisma query layer, but keeping the maths
 * separate lets us assert:
 *   - "total storage = export + dsar" is not silently over-counted.
 *   - "dbRowsTotal = sum(dbRowsX)" always holds.
 *   - Period math for the previous UTC month.
 *
 * These invariants live here so any future refactor can be validated
 * with a Jest run instead of a manual read-through.
 */

export interface StorageBytes {
  exportBytes: bigint;
  dsarBytes: bigint;
}

export interface DbRowCounts {
  user: number;
  attendance: number;
  leave: number;
  overtime: number;
  timesheetEntry: number;
  auditLog: number;
  notification: number;
  timesheetExport: number;
  webhookDelivery: number;
}

/**
 * Sum the two storage buckets into a single total. Kept trivial so
 * tests can lock the "total = export + dsar" invariant.
 */
export function computeStorageTotal(input: StorageBytes): bigint {
  const total = input.exportBytes + input.dsarBytes;
  if (total < 0n) {
    throw new RangeError('storageTotalBytes cannot be negative');
  }
  return total;
}

/**
 * Sum every table's row count into `dbRowsTotal`. We accumulate in
 * a BigInt because a mature tenant's AuditLog can push past 2^31
 * after a few years — the top-line total should stay accurate.
 */
export function computeDbRowsTotal(counts: DbRowCounts): bigint {
  const values = Object.values(counts);
  let total = 0n;
  for (const v of values) {
    if (!Number.isFinite(v) || v < 0) {
      throw new RangeError(`db row count must be non-negative, got ${v}`);
    }
    total += BigInt(v);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Period math helpers — same shape as retention-audit-findings but duplicated
// here to keep the two modules independently importable. Both anchor on UTC
// month boundaries.
// ---------------------------------------------------------------------------

export function previousUtcMonth(reference: Date): {
  periodStart: Date;
  periodEnd: Date;
} {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  const periodEnd = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  return { periodStart, periodEnd };
}

export function utcMonthRange(
  year: number,
  monthIndex1To12: number,
): { periodStart: Date; periodEnd: Date } {
  if (monthIndex1To12 < 1 || monthIndex1To12 > 12) {
    throw new RangeError(
      `utcMonthRange: monthIndex1To12 must be 1..12, got ${monthIndex1To12}`,
    );
  }
  const periodStart = new Date(
    Date.UTC(year, monthIndex1To12 - 1, 1, 0, 0, 0, 0),
  );
  const periodEnd = new Date(Date.UTC(year, monthIndex1To12, 1, 0, 0, 0, 0));
  return { periodStart, periodEnd };
}

// ---------------------------------------------------------------------------
// Formatting helpers reused by the FE table + report exports. Pure so they
// double as `packages/shared-types` candidates if we later want to share.
// ---------------------------------------------------------------------------

/**
 * Human byte formatter. `1.4 KB` / `987 MB` / `12.4 GB`. Intentionally
 * IEC (1024-based) so it matches what Linux `du -h` and cloud consoles
 * show.
 */
export function formatBytes(bytes: bigint | number): string {
  const n = typeof bytes === 'bigint' ? Number(bytes) : bytes;
  if (!Number.isFinite(n) || n < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let idx = 0;
  let val = n;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  const digits = val >= 100 || idx === 0 ? 0 : val >= 10 ? 1 : 2;
  return `${val.toFixed(digits)} ${units[idx]}`;
}
