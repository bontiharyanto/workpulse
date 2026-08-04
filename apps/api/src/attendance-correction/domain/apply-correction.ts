/**
 * Pure decision function for applying an APPROVED correction to the
 * existing `AttendanceRecord` (if any) for `(userId, workDate)`.
 *
 * Framework-free: takes the current AttendanceRecord (or null) and the
 * requested times, returns a discriminated action union the service
 * layer executes inside a transaction.
 *
 * ## Non-negotiable invariants
 *
 * 1. **Never silently overwrite a non-null field.** If the correction
 *    wants to set `clockInAt` and the existing record already has a
 *    non-null `clockInAt`, we STOP with a `CONFLICT_CLOCK_IN` action.
 *    This is defensive by design: if a punch already exists, the user
 *    should reject the correction OR file a follow-up with a note (and
 *    only SUPER_ADMIN can force via a separate endpoint — out of scope
 *    here, but the invariant makes that future work safe).
 *
 * 2. **At least one requested time.** Enforced at the DTO layer; this
 *    function additionally guards against `apply()` being called with
 *    both times null (would be a no-op mutation).
 *
 * 3. **Correction time consistency.** clockOutAt must not precede
 *    clockInAt in the RESULTING record (existing or requested). We
 *    check the *final* state, not the delta — so a correction that
 *    only sets clockOutAt but leaves an earlier existing clockInAt in
 *    place is fine, and vice versa.
 *
 * ## Action taxonomy
 *
 * - `CREATE`      — no AttendanceRecord existed; make a fresh row.
 * - `PATCH`       — an AttendanceRecord exists; fill in null fields.
 * - `CONFLICT_*`  — a field the correction wants is already non-null,
 *                   OR the resulting record violates clock-in-before-out.
 * - `NO_OP`       — an existing record already has BOTH fields set to
 *                   the requested values (idempotent replay guard).
 */

export interface AttendanceRecordSlice {
  id: string;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  /** Soft-delete carry so the caller knows to un-delete on PATCH. */
  deletedAt: Date | null;
}

export interface CorrectionRequestedTimes {
  requestedClockInAt: Date | null;
  requestedClockOutAt: Date | null;
}

export type ApplyCorrectionAction =
  | {
      kind: 'CREATE';
      /** Guaranteed non-null when kind === 'CREATE'. */
      clockInAt: Date | null;
      /** Guaranteed non-null when kind === 'CREATE'. */
      clockOutAt: Date | null;
    }
  | {
      kind: 'PATCH';
      recordId: string;
      /** null → leave the DB column as-is. */
      setClockInAt: Date | null;
      setClockOutAt: Date | null;
      /** Un-delete flag — set to true when patching a soft-deleted row. */
      restoreSoftDeleted: boolean;
    }
  | { kind: 'NO_OP'; recordId: string }
  | {
      kind: 'CONFLICT';
      /**
       * Stable, machine-parseable code the service layer maps to a 409
       * ConflictException. The FE surfaces a targeted error message per
       * code.
       */
      code:
        'CONFLICT_CLOCK_IN' | 'CONFLICT_CLOCK_OUT' | 'INVALID_TIME_ORDER' | 'NO_TIMES_REQUESTED';
    };

export function planCorrectionApply(
  existing: AttendanceRecordSlice | null,
  requested: CorrectionRequestedTimes,
): ApplyCorrectionAction {
  const { requestedClockInAt, requestedClockOutAt } = requested;

  if (!requestedClockInAt && !requestedClockOutAt) {
    return { kind: 'CONFLICT', code: 'NO_TIMES_REQUESTED' };
  }

  if (!existing) {
    // No record → CREATE. Both times MUST be present because an
    // AttendanceRecord with only one punch is semantically identical
    // to an "incomplete session" we can't pay against. If only one
    // side was requested, refuse — the user must file a full correction
    // OR let the auto-scheduler mark them absent first, then correct.
    if (!requestedClockInAt || !requestedClockOutAt) {
      return {
        kind: 'CONFLICT',
        code: !requestedClockInAt ? 'CONFLICT_CLOCK_IN' : 'CONFLICT_CLOCK_OUT',
      };
    }
    if (requestedClockOutAt.getTime() < requestedClockInAt.getTime()) {
      return { kind: 'CONFLICT', code: 'INVALID_TIME_ORDER' };
    }
    return {
      kind: 'CREATE',
      clockInAt: requestedClockInAt,
      clockOutAt: requestedClockOutAt,
    };
  }

  // Existing record — the patch may only fill *null* fields.
  const wantsClockIn = requestedClockInAt !== null;
  const wantsClockOut = requestedClockOutAt !== null;

  if (wantsClockIn && existing.clockInAt !== null) {
    // Idempotent replay: same value → NO_OP, otherwise real conflict.
    if (existing.clockInAt.getTime() !== requestedClockInAt.getTime()) {
      return { kind: 'CONFLICT', code: 'CONFLICT_CLOCK_IN' };
    }
  }
  if (wantsClockOut && existing.clockOutAt !== null) {
    if (existing.clockOutAt.getTime() !== requestedClockOutAt.getTime()) {
      return { kind: 'CONFLICT', code: 'CONFLICT_CLOCK_OUT' };
    }
  }

  const finalClockIn =
    wantsClockIn && existing.clockInAt === null ? requestedClockInAt : existing.clockInAt;
  const finalClockOut =
    wantsClockOut && existing.clockOutAt === null ? requestedClockOutAt : existing.clockOutAt;

  if (finalClockIn && finalClockOut && finalClockOut.getTime() < finalClockIn.getTime()) {
    return { kind: 'CONFLICT', code: 'INVALID_TIME_ORDER' };
  }

  // Determine what actually needs to be written.
  const setClockInAt = wantsClockIn && existing.clockInAt === null ? requestedClockInAt : null;
  const setClockOutAt = wantsClockOut && existing.clockOutAt === null ? requestedClockOutAt : null;

  if (!setClockInAt && !setClockOutAt && existing.deletedAt === null) {
    // Everything the correction asked for is already correct → idempotent.
    return { kind: 'NO_OP', recordId: existing.id };
  }

  return {
    kind: 'PATCH',
    recordId: existing.id,
    setClockInAt,
    setClockOutAt,
    restoreSoftDeleted: existing.deletedAt !== null,
  };
}
