/**
 * Leave-summary report shaping — pure functions.
 *
 * Emits one row per (user × leaveType) pair for the target year. Users without
 * a balance row for a given leave type still appear with zeros to keep the
 * matrix rectangular.
 */

export interface LeaveSummaryReportRow {
  userFullName: string;
  userEmail: string;
  departmentName: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  year: number;
  quota: number;
  carriedOver: number;
  used: number;
  reserved: number;
  remaining: number;
}

export interface LeaveSummaryRawUser {
  id: string;
  fullName: string;
  email: string;
  department: { name: string } | null;
  balances: ReadonlyArray<{
    leaveTypeId: string;
    year: number;
    quota: number;
    carriedOver: number;
    used: number;
    reserved: number;
    remaining: number;
  }>;
}

export interface LeaveSummaryRawLeaveType {
  id: string;
  code: string;
  name: string;
}

/**
 * Build a (user × leaveType) matrix. Users appear even without balance rows
 * so HR can quickly see who was missed by backfill.
 */
export function toLeaveSummaryRows(
  users: ReadonlyArray<LeaveSummaryRawUser>,
  leaveTypes: ReadonlyArray<LeaveSummaryRawLeaveType>,
  year: number,
): LeaveSummaryReportRow[] {
  const rows: LeaveSummaryReportRow[] = [];
  for (const u of users) {
    for (const lt of leaveTypes) {
      const bal = u.balances.find((b) => b.leaveTypeId === lt.id && b.year === year);
      rows.push({
        userFullName: u.fullName,
        userEmail: u.email,
        departmentName: u.department?.name ?? '—',
        leaveTypeCode: lt.code,
        leaveTypeName: lt.name,
        year,
        quota: bal?.quota ?? 0,
        carriedOver: bal?.carriedOver ?? 0,
        used: bal?.used ?? 0,
        reserved: bal?.reserved ?? 0,
        remaining: bal?.remaining ?? 0,
      });
    }
  }
  return rows;
}

export interface LeaveSummaryTotals {
  users: number;
  leaveTypes: number;
  totalQuota: number;
  totalUsed: number;
  totalReserved: number;
  totalRemaining: number;
}

export function summarizeLeave(rows: ReadonlyArray<LeaveSummaryReportRow>): LeaveSummaryTotals {
  const seenUsers = new Set<string>();
  const seenTypes = new Set<string>();
  let totalQuota = 0;
  let totalUsed = 0;
  let totalReserved = 0;
  let totalRemaining = 0;
  for (const r of rows) {
    seenUsers.add(r.userEmail);
    seenTypes.add(r.leaveTypeCode);
    totalQuota += r.quota + r.carriedOver;
    totalUsed += r.used;
    totalReserved += r.reserved;
    totalRemaining += r.remaining;
  }
  return {
    users: seenUsers.size,
    leaveTypes: seenTypes.size,
    totalQuota,
    totalUsed,
    totalReserved,
    totalRemaining,
  };
}
