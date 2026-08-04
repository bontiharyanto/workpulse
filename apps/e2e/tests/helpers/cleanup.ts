import type { APIRequestContext } from '@playwright/test';

/**
 * E2E hygiene helpers — best-effort deletion / cancellation of records
 * that would otherwise cause `DUPLICATE_WORK_DATE`, `DUPLICATE_PENDING`,
 * or similar `(userId, workDate)` uniqueness collisions when a test
 * re-runs against a persistent database.
 *
 * All helpers are idempotent and silently no-op when the target row is
 * absent — callers can wire them into `test.beforeEach` / `test.beforeAll`
 * without needing to first probe for existence.
 *
 * The seed helpers are the *only* place we speak the API's cancellation
 * verbs. Specs stay focused on the property they assert; the housekeeping
 * lives here.
 */

interface OvertimeRow {
  id: string;
  workDate: string;
  status: string;
}

interface LeaveRow {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
}

/**
 * Cancel every non-terminal overtime request the caller owns that lands
 * on the given `workDate`. Terminal statuses (`REJECTED`, `CANCELLED`,
 * `COMPLETED`) are left alone — the `(userId, workDate)` unique index
 * on `OvertimeRequest` scopes to non-terminal rows via a partial index,
 * so cancelled rows never collide with a fresh submission.
 *
 * Silently ignores rows we cannot cancel (already terminal, or the
 * server returns 409 for a race) — the goal is "give the caller a clean
 * slate", not "prove every cancel succeeds".
 */
export async function cancelOvertimeFor(
  api: APIRequestContext,
  workDate: string,
): Promise<void> {
  const res = await api.get('/api/v1/overtime/mine');
  if (!res.ok()) return;
  const rows = (await res.json()) as OvertimeRow[];
  const targets = rows.filter(
    (r) =>
      r.workDate.startsWith(workDate) &&
      r.status !== 'CANCELLED' &&
      r.status !== 'REJECTED' &&
      r.status !== 'COMPLETED',
  );
  for (const r of targets) {
    await api.post(`/api/v1/overtime/${r.id}/cancel`).catch(() => undefined);
  }
}

/**
 * Cancel every non-terminal leave request the caller owns that overlaps
 * the given `[startDate, endDate]` window (inclusive on both ends).
 * Same "best-effort, terminal-safe" contract as `cancelOvertimeFor`.
 */
export async function cancelLeaveOverlapping(
  api: APIRequestContext,
  startDate: string,
  endDate: string,
): Promise<void> {
  const res = await api.get('/api/v1/leave/mine');
  if (!res.ok()) return;
  const rows = (await res.json()) as LeaveRow[];
  const targets = rows.filter((r) => {
    if (
      r.status === 'CANCELLED' ||
      r.status === 'REJECTED'
    ) {
      return false;
    }
    // Overlap iff r.startDate <= endDate && r.endDate >= startDate.
    const rs = r.startDate.slice(0, 10);
    const re = r.endDate.slice(0, 10);
    return rs <= endDate && re >= startDate;
  });
  for (const r of targets) {
    await api.post(`/api/v1/leave/${r.id}/cancel`).catch(() => undefined);
  }
}
