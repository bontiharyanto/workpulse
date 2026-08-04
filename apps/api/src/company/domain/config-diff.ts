/**
 * Produces a shallow diff of two configuration snapshots for audit-log
 * `beforeJson` / `afterJson` payloads. Only keys whose values actually
 * changed are included, so a partial PATCH doesn't pollute the audit trail
 * with unchanged fields.
 *
 * Deep equality is unnecessary — all Company config fields are primitives
 * (string, number, null). `===` on `Prisma.Decimal` fails on identical
 * numeric values though, so callers must first coerce Decimal → number
 * before passing in.
 */
export function diffChangedKeys<T extends Record<string, unknown>>(
  before: T,
  after: T,
): { before: Partial<T>; after: Partial<T> } {
  const beforeDiff: Partial<T> = {};
  const afterDiff: Partial<T> = {};

  for (const key of Object.keys(after) as Array<keyof T>) {
    if (before[key] !== after[key]) {
      beforeDiff[key] = before[key];
      afterDiff[key] = after[key];
    }
  }

  return { before: beforeDiff, after: afterDiff };
}
