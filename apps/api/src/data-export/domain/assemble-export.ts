import * as archiverPkg from 'archiver';
import type { Readable } from 'node:stream';

// `archiver`'s CJS default export is the callable factory; the ESM
// interop shape is `.default`. `esModuleInterop=true` at the tsconfig
// level makes both forms work but bundlers occasionally trip on the
// synthetic default, so we unwrap explicitly.
const archiver = ((archiverPkg as unknown as { default?: unknown }).default ?? archiverPkg) as (
  format: 'zip',
  opts?: unknown,
) => import('archiver').Archiver;

import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Assemble the DSAR archive for a single user. Every collection we
 * export is scoped to `userId` (with a defensive re-check against
 * `companyId` where the FK does not already prove tenant isolation).
 *
 * Design notes:
 *
 * - **JSON per resource, not a single monolithic file.** Auditors and
 *   users can inspect each file in isolation. Filenames follow a
 *   stable, machine-readable convention (`<resource>.json`), which we
 *   surface in `README.txt`.
 * - **Passwords, MFA secrets, tokens NEVER leave the DB.** We ship
 *   only the metadata (createdAt, revokedAt, mfaEnabledAt boolean,
 *   backup-code count). Anything that could re-authenticate the user
 *   is deliberately withheld — otherwise the DSAR itself becomes a
 *   credential-exfiltration vector.
 * - **Deterministic-ish ordering.** Rows are sorted by `createdAt`
 *   descending inside each file so a re-generated archive diffs
 *   nicely against an earlier one.
 * - **`Buffer` output, not stream-to-S3.** Users have bounded data
 *   sizes (~10 MB even after 5 years of clocking in daily). Buffering
 *   in memory is simpler and avoids the streaming pitfalls with
 *   `PutObjectCommand`'s Content-Length signing.
 */
export interface AssembleInput {
  userId: string;
  companyId: string;
  requestId: string;
  requestedAt: Date;
}

export interface AssembleResult {
  buffer: Buffer;
  size: number;
  fileCount: number;
}

export async function assembleExportArchive(
  prisma: PrismaService,
  input: AssembleInput,
): Promise<AssembleResult> {
  const snapshot = await loadSnapshot(prisma, input);

  const files: Array<{ name: string; body: string }> = [
    { name: 'profile.json', body: stringify(snapshot.profile) },
    { name: 'company.json', body: stringify(snapshot.company) },
    { name: 'department.json', body: stringify(snapshot.department) },
    { name: 'shift-assignments.json', body: stringify(snapshot.shiftAssignments) },
    { name: 'attendance.json', body: stringify(snapshot.attendance) },
    {
      name: 'attendance-events.json',
      body: stringify(snapshot.attendanceEvents),
    },
    {
      name: 'attendance-corrections.json',
      body: stringify(snapshot.attendanceCorrections),
    },
    { name: 'absences.json', body: stringify(snapshot.absences) },
    { name: 'leave-balances.json', body: stringify(snapshot.leaveBalances) },
    { name: 'leave-requests.json', body: stringify(snapshot.leaveRequests) },
    { name: 'overtime.json', body: stringify(snapshot.overtime) },
    { name: 'notifications.json', body: stringify(snapshot.notifications) },
    {
      name: 'notification-preferences.json',
      body: stringify(snapshot.notificationPreferences),
    },
    { name: 'sessions.json', body: stringify(snapshot.sessions) },
    { name: 'audit-log.json', body: stringify(snapshot.auditLog) },
    { name: 'security.json', body: stringify(snapshot.security) },
    {
      name: 'README.txt',
      body: renderReadme(input, snapshot),
    },
  ];

  return zipFiles(files);
}

async function loadSnapshot(prisma: PrismaService, { userId, companyId }: AssembleInput) {
  // We fan out with `Promise.all` because each read is independent
  // and hits different tables. The reads are bounded by `userId`, so
  // even a chatty active user tops out around a few hundred rows per
  // resource.
  const [
    profile,
    company,
    department,
    shiftAssignments,
    attendance,
    attendanceEvents,
    attendanceCorrections,
    absences,
    leaveBalances,
    leaveRequests,
    overtime,
    notifications,
    notificationPreferences,
    sessions,
    auditLog,
    mfaBackupCodes,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        employmentStatus: true,
        hiredAt: true,
        supervisorId: true,
        timezone: true,
        overtimeHourlyRate: true,
        mustChangePassword: true,
        mfaEnabledAt: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    }),
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        timezone: true,
        overtimeHourlyRate: true,
      },
    }),
    prisma.department.findFirst({
      where: {
        companyId,
        users: { some: { id: userId } },
      },
      select: { id: true, name: true },
    }),
    prisma.userShiftAssignment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.attendanceRecord.findMany({
      where: { userId },
      orderBy: { workDate: 'desc' },
    }),
    prisma.attendanceEvent.findMany({
      where: { attendance: { userId } },
      orderBy: { occurredAt: 'desc' },
    }),
    prisma.attendanceCorrection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.absenceRecord.findMany({
      where: { userId },
      orderBy: { workDate: 'desc' },
    }),
    prisma.leaveBalance.findMany({
      where: { userId },
      orderBy: { year: 'desc' },
    }),
    prisma.leaveRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.overtimeRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.notification.findMany({
      where: { recipientId: userId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.notificationPreference.findMany({
      where: { userId },
    }),
    prisma.refreshToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        userAgent: true,
        ip: true,
        mfaVerified: true,
        expiresAt: true,
        createdAt: true,
        revokedAt: true,
      },
    }),
    prisma.auditLog.findMany({
      where: { actorId: userId },
      orderBy: { createdAt: 'desc' },
      take: 5000, // hard cap: DSARs rarely need the full lifetime log
    }),
    prisma.mfaBackupCode.count({ where: { userId } }),
  ]);

  return {
    profile,
    company,
    department,
    shiftAssignments,
    attendance,
    attendanceEvents,
    attendanceCorrections,
    absences,
    leaveBalances,
    leaveRequests,
    overtime,
    notifications,
    notificationPreferences,
    sessions,
    auditLog,
    security: {
      mfaBackupCodeCount: mfaBackupCodes,
      mfaEnabledAt: profile?.mfaEnabledAt ?? null,
      // Deliberate omissions — see file-header note. Kept in a
      // structured "redacted" block so a machine consumer can tell
      // "we chose not to include this" from "this field doesn't
      // exist".
      redactedFields: [
        'user.passwordHash',
        'user.mfaSecret',
        'refreshToken.tokenHash',
        'mfaBackupCode.codeHash',
        'passwordResetToken.tokenHash',
      ],
    },
  };
}

/**
 * Pretty-print JSON so a human can read the archive directly. `Decimal`,
 * `Date`, and `Buffer` all get sensible defaults via `JSON.stringify`
 * because Prisma serialises them into ISO strings + hex, but Decimal
 * objects come back as JS objects — we normalise those to `toString()`.
 */
function stringify(value: unknown): string {
  return JSON.stringify(value, replacer, 2);
}

function replacer(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    'toFixed' in (value as object) &&
    typeof (value as { toFixed?: unknown }).toFixed === 'function'
  ) {
    // Prisma Decimal — stringify to preserve precision.
    return (value as { toString(): string }).toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Buffer) return value.toString('base64');
  return value;
}

function renderReadme(
  input: AssembleInput,
  snapshot: Awaited<ReturnType<typeof loadSnapshot>>,
): string {
  const lines = [
    'Workpulse — Data Subject Access Request (DSAR)',
    '==============================================',
    '',
    `Request ID   : ${input.requestId}`,
    `Requested at : ${input.requestedAt.toISOString()}`,
    `User ID      : ${input.userId}`,
    `Email        : ${snapshot.profile?.email ?? '(deleted)'}`,
    `Company      : ${snapshot.company?.name ?? '(deleted)'}`,
    '',
    'This archive contains every piece of personal data Workpulse',
    'stores about you. Each file is a JSON array of rows from a',
    'single database table, joined on your user id.',
    '',
    'Files:',
    '  profile.json                — your user record',
    '  company.json                — the tenant you belong to',
    '  department.json             — your department, if any',
    '  shift-assignments.json      — historical + current shift bindings',
    '  attendance.json             — every clock-in / clock-out record',
    '  attendance-events.json      — the fine-grained event log per record',
    '  attendance-corrections.json — correction requests you filed',
    '  absences.json               — auto-absent + HR-marked absences',
    '  leave-balances.json         — leave quota rows per period',
    '  leave-requests.json         — every leave request you submitted',
    '  overtime.json               — every overtime request you submitted',
    '  notifications.json          — the in-app notification archive',
    '  notification-preferences.json — your per-type opt-in matrix',
    '  sessions.json               — refresh-token metadata (no tokens)',
    '  audit-log.json              — up to the last 5,000 audit entries',
    '                                 where you were the actor',
    '  security.json               — MFA metadata + the "what we did NOT',
    '                                 include" redaction manifest',
    '',
    'What is NOT in this archive:',
    '  * password hash             — not personal data, not useful to you',
    '  * MFA TOTP secret           — encrypted; disclosure would let',
    '                                anyone with a copy generate MFA codes',
    '  * refresh-token hashes      — same reason as the MFA secret',
    '  * MFA backup-code hashes    — one-way; sharing them defeats the',
    '                                point of one-time backup codes',
    '',
    'Retention:',
    '  This archive is deleted from our storage 24 hours after it was',
    '  produced. Please download it promptly and store it somewhere',
    '  safe. If you need another copy, submit a fresh request from',
    '  /settings/privacy.',
  ];
  return lines.join('\n') + '\n';
}

/**
 * Small wrapper that produces a real ZIP blob using `archiver`. We do
 * not stream to S3 directly — see the file header for the rationale.
 */
function zipFiles(files: Array<{ name: string; body: string }>): Promise<AssembleResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const zip = archiver('zip', { zlib: { level: 9 } });

    zip.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.on('warning', (err: NodeJS.ErrnoException) => {
      // `ENOENT` on entry addition is a real failure; other warnings
      // are informational (e.g. UTF-8 flag adjustments).
      if (err.code === 'ENOENT') reject(err);
    });
    zip.on('error', reject);
    zip.on('end', () => {
      const buffer = Buffer.concat(chunks);
      resolve({ buffer, size: buffer.byteLength, fileCount: files.length });
    });

    for (const f of files) {
      zip.append(f.body, { name: f.name });
    }
    void zip.finalize();
  });
}

// Exported for tests that need to inspect the archive without wiring
// the full worker.
export const __testables = {
  stringify,
  renderReadme,
};

// Silence unused import warning when Readable ever gets referenced by
// future streaming variants.
export type __StreamShim = Readable;
