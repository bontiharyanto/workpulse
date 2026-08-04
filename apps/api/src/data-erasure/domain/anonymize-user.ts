import { randomBytes } from 'node:crypto';

import type { Prisma } from '@prisma/client';

/**
 * Anonymise a user in the DB inside the caller's transaction. The
 * function does NOT delete rows outside the personal-data set — HR
 * attendance, leave, overtime, corrections, absences, and audit rows
 * are retained because tax law (UU Ketenagakerjaan) and audit
 * requirements demand a multi-year retention window.
 *
 * What DOES change:
 *
 *   - `User.email`         → `erased-<userId>@workpulse.deleted`
 *                            (globally unique, non-routable domain)
 *   - `User.fullName`      → `Erased User`
 *   - `User.passwordHash`  → 64 random bytes hex (cannot log in)
 *   - `User.mfaSecret`     → NULL
 *   - `User.mfaEnabledAt`  → NULL
 *   - `User.mustChangePassword` → false
 *   - `User.employmentStatus`   → TERMINATED
 *   - `User.deletedAt`     → now  (soft delete boundary)
 *   - Every `MfaBackupCode` row for the user is deleted.
 *   - Every `PasswordResetToken` row is deleted.
 *   - Every `NotificationPreference` row is deleted.
 *   - Every `Notification` row for the user is deleted (they can
 *     legitimately reference other users' names, which we cannot
 *     scrub retroactively).
 *   - Every `RefreshToken` row is revoked.
 *   - Every `DataExportRequest` fileKey is nulled and status flipped
 *     to `EXPIRED` (S3 deletion happens outside the transaction; see
 *     service). Rows themselves survive as audit anchors.
 *
 * What is DELIBERATELY kept:
 *
 *   - `AttendanceRecord` + `AttendanceEvent` (labour-law retention)
 *   - `AbsenceRecord`
 *   - `LeaveRequest`, `LeaveBalance`
 *   - `OvertimeRequest`
 *   - `AttendanceCorrection`
 *   - `AuditLog` rows where the user was actor  (compliance evidence)
 *   - `UserShiftAssignment`
 *
 * These records have their own tenant-side retention lifecycle. If a
 * tenant needs to purge them separately, that's a distinct Fase 31c
 * workflow (retention automation).
 *
 * Returned metadata is written to the audit log by the caller.
 */
export interface AnonymizeInput {
  userId: string;
  companyId: string;
  erasureRequestId: string;
  now: Date;
}

export interface AnonymizeResult {
  erasedEmail: string;
  refreshTokensRevoked: number;
  backupCodesDeleted: number;
  notificationsDeleted: number;
  passwordResetsDeleted: number;
  notificationPrefsDeleted: number;
  /** File keys still living in S3 — the caller deletes them out-of-tx. */
  dataExportFileKeys: string[];
}

export async function anonymizeUser(
  tx: Prisma.TransactionClient,
  input: AnonymizeInput,
): Promise<AnonymizeResult> {
  const { userId, now } = input;

  // Read-then-write for the small counts we surface to the audit log.
  // Prisma's `deleteMany` returns a `.count`, so no separate reads
  // are needed except for the data-export S3 keys.
  const backupCodesDeleted = await tx.mfaBackupCode
    .deleteMany({ where: { userId } })
    .then((r) => r.count);

  const passwordResetsDeleted = await tx.passwordResetToken
    .deleteMany({ where: { userId } })
    .then((r) => r.count);

  const notificationPrefsDeleted = await tx.notificationPreference
    .deleteMany({ where: { userId } })
    .then((r) => r.count);

  const notificationsDeleted = await tx.notification
    .deleteMany({ where: { recipientId: userId } })
    .then((r) => r.count);

  const refreshTokensRevoked = await tx.refreshToken
    .updateMany({
      where: {
        userId,
        // Revoke ACTIVE and ROTATED alike. A ROTATED row can technically
        // never be used again but flipping it to REVOKED is truthful and
        // helps forensic queries.
        status: { in: ['ACTIVE', 'ROTATED'] },
      },
      data: {
        status: 'REVOKED',
        revokedAt: now,
      },
    })
    .then((r) => r.count);

  // Flip export rows to EXPIRED; capture S3 keys for the caller to
  // delete out-of-transaction. We can't call the S3 API from inside a
  // Postgres tx without deadlock risk on the connection pool.
  const openExports = await tx.dataExportRequest.findMany({
    where: {
      userId,
      status: { in: ['PENDING', 'PROCESSING', 'READY'] },
    },
    select: { id: true, fileKey: true },
  });
  const dataExportFileKeys = openExports
    .map((r) => r.fileKey)
    .filter((k): k is string => k !== null && k !== undefined);
  if (openExports.length > 0) {
    await tx.dataExportRequest.updateMany({
      where: { id: { in: openExports.map((r) => r.id) } },
      data: {
        status: 'EXPIRED',
        fileKey: null,
      },
    });
  }

  // Finally, the user row. Compose the tombstone email so it is unique
  // across the tenant AND across time — a subsequent request for the
  // same id would collide otherwise.
  const erasedEmail = `erased-${userId}@workpulse.deleted`;
  const unusableHash = randomBytes(64).toString('hex');

  await tx.user.update({
    where: { id: userId },
    data: {
      email: erasedEmail,
      fullName: 'Erased User',
      passwordHash: unusableHash,
      mfaSecret: null,
      mfaEnabledAt: null,
      mustChangePassword: false,
      employmentStatus: 'TERMINATED',
      deletedAt: now,
    },
  });

  return {
    erasedEmail,
    refreshTokensRevoked,
    backupCodesDeleted,
    notificationsDeleted,
    passwordResetsDeleted,
    notificationPrefsDeleted,
    dataExportFileKeys,
  };
}
