/**
 * Catalog of known audit log entity types + action codes, plus the (few)
 * external routes the FE knows about today. Used by the audit log
 * viewer for autocomplete and the optional "open" icon.
 *
 * ## Why co-located here (not in shared-types)
 *
 * These lists are **hints for the human at the keyboard**, not a
 * validation contract. The API accepts ANY string filter — a new
 * writer added on the backend will work even if this catalog is out
 * of date. So we treat this file as a soft-hint UX resource, not a
 * source of truth. Keeping it FE-side avoids a shared-types churn
 * every time we add a new audit action.
 *
 * ## Update policy
 *
 * When a new audit writer is added to the API, add the action code
 * here so it shows up in the autocomplete dropdown. Missing entries
 * degrade to "type the string yourself" — the filter still works.
 */

/**
 * All action codes we know the backend writes today. Sorted for
 * predictable ordering in the datalist. Writer sites live under
 * `apps/api/src/*` service files — grep for `action:` on a string
 * literal to find them.
 */
export const KNOWN_AUDIT_ACTIONS = [
  // Leave
  'LEAVE_REQUEST_SUBMITTED',
  'LEAVE_REQUEST_APPROVED',
  'LEAVE_REQUEST_REJECTED',
  'LEAVE_REQUEST_CANCELLED',
  // Overtime
  'OVERTIME_SUBMITTED',
  'OVERTIME_APPROVED',
  'OVERTIME_REJECTED',
  'OVERTIME_CANCELLED',
  // Attendance
  'ATTENDANCE_CLOCK_IN',
  'ATTENDANCE_CLOCK_OUT',
  'ATTENDANCE_MARK_ABSENT',
  'ATTENDANCE_UNMARK_ABSENT',
  // Attendance correction
  'ATTENDANCE_CORRECTION_SUBMITTED',
  'ATTENDANCE_CORRECTION_APPROVED',
  'ATTENDANCE_CORRECTION_REJECTED',
  'ATTENDANCE_CORRECTION_CANCELLED',
  // Company / ops
  'COMPANY_CONFIG_UPDATED',
  'SCANNER_CURSOR_RESET',
] as const;

/**
 * All entity types the backend touches. Sorted; not exhaustive but
 * covers everything current writers emit.
 */
export const KNOWN_AUDIT_ENTITY_TYPES = [
  'AbsenceRecord',
  'AttendanceCorrection',
  'AttendanceRecord',
  'Company',
  'LeaveRequest',
  'OvertimeRequest',
] as const;

/**
 * External destination for a given entity type. `null` when no
 * dedicated FE page exists — the row just isn't rendered as a link
 * in that case. Static route + no id parameter today; when we add
 * detail pages (`/leave/[id]`, etc.) this is where the mapping
 * lives.
 *
 * NOTE: `Company` maps to the single-tenant config page — there is
 * no id in the route because the current session already implies
 * which company we're looking at. Payload's `entityId` will be the
 * caller's own `companyId`, so this deep-link is always meaningful.
 */
export function externalRouteFor(
  entityType: string,
  _entityId: string,
): string | null {
  switch (entityType) {
    case 'Company':
      return '/admin/company';
    default:
      // Everything else has no detail page yet. Adding one is a
      // future-fase task; when it lands, update the switch above.
      return null;
  }
}
