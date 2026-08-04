import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { __testables, assembleExportArchive } from './assemble-export';
import { PrismaService } from '../../prisma/prisma.service';

// Prisma methods are numerous — auto-mock everything and only stub the
// specific `findMany` / `findUnique` returns we care about.
describe('assembleExportArchive', () => {
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    mockReset(prisma);

    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'alice@example.com',
      fullName: 'Alice',
      role: 'EMPLOYEE',
      employmentStatus: 'ACTIVE',
      hiredAt: new Date('2024-01-01'),
      supervisorId: null,
      timezone: 'Asia/Jakarta',
      overtimeHourlyRate: null,
      mustChangePassword: false,
      mfaEnabledAt: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      deletedAt: null,
    } as never);
    prisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      name: 'Acme',
      timezone: 'Asia/Jakarta',
      overtimeHourlyRate: null,
    } as never);
    prisma.department.findFirst.mockResolvedValue(null);
    prisma.userShiftAssignment.findMany.mockResolvedValue([] as never);
    prisma.attendanceRecord.findMany.mockResolvedValue([] as never);
    prisma.attendanceEvent.findMany.mockResolvedValue([] as never);
    prisma.attendanceCorrection.findMany.mockResolvedValue([] as never);
    prisma.absenceRecord.findMany.mockResolvedValue([] as never);
    prisma.leaveBalance.findMany.mockResolvedValue([] as never);
    prisma.leaveRequest.findMany.mockResolvedValue([] as never);
    prisma.overtimeRequest.findMany.mockResolvedValue([] as never);
    prisma.notification.findMany.mockResolvedValue([] as never);
    prisma.notificationPreference.findMany.mockResolvedValue([] as never);
    prisma.refreshToken.findMany.mockResolvedValue([] as never);
    prisma.auditLog.findMany.mockResolvedValue([] as never);
    prisma.mfaBackupCode.count.mockResolvedValue(0);
  });

  it('produces a non-empty ZIP with the expected member files', async () => {
    const result = await assembleExportArchive(prisma, {
      userId: 'user-1',
      companyId: 'company-1',
      requestId: 'req-1',
      requestedAt: new Date('2026-08-01T00:00:00Z'),
    });

    expect(result.size).toBeGreaterThan(0);
    expect(result.buffer.byteLength).toBe(result.size);
    expect(result.fileCount).toBeGreaterThanOrEqual(15);
    // Magic bytes: `PK\x03\x04` — every ZIP starts with these.
    expect(result.buffer[0]).toBe(0x50);
    expect(result.buffer[1]).toBe(0x4b);
    expect(result.buffer[2]).toBe(0x03);
    expect(result.buffer[3]).toBe(0x04);
  });

  it('scopes every read to the caller (userId / companyId) — no cross-tenant leakage', async () => {
    await assembleExportArchive(prisma, {
      userId: 'user-1',
      companyId: 'company-1',
      requestId: 'req-1',
      requestedAt: new Date(),
    });

    expect(prisma.attendanceRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { actorId: 'user-1' } }),
    );
    // Notifications join on recipient, not `userId` — verify that
    // subtlety so nobody "helpfully" refactors it into a leak.
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recipientId: 'user-1' } }),
    );
  });

  it('caps the audit log to at most 5,000 rows to protect the archive size', async () => {
    await assembleExportArchive(prisma, {
      userId: 'user-1',
      companyId: 'company-1',
      requestId: 'req-1',
      requestedAt: new Date(),
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5000 }));
  });
});

describe('README rendering', () => {
  it('lists the redaction set so a user can see what we chose not to include', () => {
    const readme = __testables.renderReadme(
      {
        userId: 'user-1',
        companyId: 'company-1',
        requestId: 'req-1',
        requestedAt: new Date('2026-08-01T00:00:00Z'),
      },
      {
        profile: { email: 'alice@example.com' },
        company: { name: 'Acme' },
      } as never,
    );

    expect(readme).toContain('password hash');
    expect(readme).toContain('MFA TOTP secret');
    expect(readme).toContain('refresh-token hashes');
    expect(readme).toContain('MFA backup-code hashes');
  });
});

// Referenced only so lint doesn't drop the imports we keep intentionally
// for future streaming-oriented follow-ups.
async function _consume(readable: Readable): Promise<void> {
  await pipeline(readable, async function* (source) {
    for await (const chunk of source) yield chunk;
  });
}
_consume; // keep tsc happy without executing
