import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  TimesheetExportFormat,
  TimesheetExportMode,
  TimesheetPeriodType,
  TimesheetStatus,
} from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { TimesheetExportService } from './timesheet-export.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import type { WebhookDispatcher } from '../webhook/webhook-dispatcher.service';

interface Kit {
  service: TimesheetExportService;
  prisma: DeepMockProxy<PrismaService>;
  webhookDispatcher: { enqueue: jest.Mock };
}

function buildKit(): Kit {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  (prisma.$transaction as unknown as jest.Mock).mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: PrismaService) => unknown)(prisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
  const webhookDispatcher = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const service = new TimesheetExportService(
    prisma as unknown as PrismaService,
    webhookDispatcher as unknown as WebhookDispatcher,
  );
  return { service, prisma, webhookDispatcher };
}

function makeActor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'actor-hr',
    companyId: 'c-1',
    departmentId: null,
    email: 'hr@example.com',
    role: 'HR_MANAGER',
    ...overrides,
  };
}

function makePeriod() {
  return {
    id: 'p-1',
    companyId: 'c-1',
    periodType: TimesheetPeriodType.MONTHLY,
    periodStart: new Date('2026-01-01T00:00:00Z'),
    periodEnd: new Date('2026-01-31T00:00:00Z'),
    label: '2026-01',
    createdAt: new Date(),
    company: { name: 'Acme', timezone: 'Asia/Jakarta' },
  };
}

function makeTimesheet(id: string) {
  return {
    id,
    companyId: 'c-1',
    userId: `user-${id}`,
    periodId: 'p-1',
    totalRegularHours: 80,
    totalOvertimeHours: 2,
    totalLeaveDays: 0,
    totalAbsentDays: 0,
    totalHolidays: 0,
    totalWorkingDays: 10,
    totalLateMinutes: 5,
    totalEarlyLeaveMinutes: 0,
    generatedAt: new Date(),
    status: TimesheetStatus.APPROVED,
    submittedAt: null,
    supervisorId: null,
    supervisorAt: null,
    supervisorNote: null,
    hrManagerId: null,
    hrManagerAt: null,
    hrManagerNote: null,
    rejectedById: null,
    rejectedAt: null,
    rejectionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {
      id: `user-${id}`,
      fullName: `Employee ${id}`,
      email: `${id}@acme.test`,
      overtimeHourlyRate: 50_000,
      department: { name: 'Eng' },
    },
    entries: [],
  };
}

describe('TimesheetExportService (Fase 32c)', () => {
  it('refuses non-HR actors', async () => {
    const { service } = buildKit();
    await expect(
      service.export(makeActor({ role: 'EMPLOYEE' }), {
        periodId: 'p-1',
        format: TimesheetExportFormat.CSV,
        mode: TimesheetExportMode.SUMMARY,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses when the period has no APPROVED timesheets', async () => {
    const { service, prisma } = buildKit();
    prisma.timesheetPeriod.findFirst.mockResolvedValue(makePeriod() as never);
    prisma.timesheet.findMany.mockResolvedValue([] as never);

    await expect(
      service.export(makeActor(), {
        periodId: 'p-1',
        format: TimesheetExportFormat.CSV,
        mode: TimesheetExportMode.SUMMARY,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('renders CSV, computes SHA-256, and writes an audit row', async () => {
    const { service, prisma } = buildKit();
    prisma.timesheetPeriod.findFirst.mockResolvedValue(makePeriod() as never);
    prisma.timesheet.findMany.mockResolvedValue([makeTimesheet('a'), makeTimesheet('b')] as never);
    (prisma.timesheetExport.create as unknown as jest.Mock).mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'export-1',
        createdAt: new Date('2026-02-01T00:00:00Z'),
        ...data,
      }),
    );
    prisma.auditLog.create.mockResolvedValue({} as never);

    const result = await service.export(makeActor(), {
      periodId: 'p-1',
      format: TimesheetExportFormat.CSV,
      mode: TimesheetExportMode.SUMMARY,
    });

    // Audit row committed before the payload is returned.
    expect(prisma.timesheetExport.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'TIMESHEET_EXPORTED',
          entityType: 'TimesheetExport',
        }),
      }),
    );

    // The hash on the response matches the payload actually returned.
    const { createHash } = await import('node:crypto');
    const localHash = createHash('sha256').update(result.payload).digest('hex');
    expect(result.export.payloadSha256).toBe(localHash);
    expect(result.export.rowCount).toBe(2);
    expect(result.contentType).toContain('text/csv');
    expect(result.filename).toMatch(/^payroll-.*\.csv$/);
  });

  it('produces byte-identical CSV payloads for repeated calls with same input (idempotence)', async () => {
    const { service, prisma } = buildKit();
    prisma.timesheetPeriod.findFirst.mockResolvedValue(makePeriod() as never);
    prisma.timesheet.findMany.mockResolvedValue([makeTimesheet('a')] as never);
    (prisma.timesheetExport.create as unknown as jest.Mock).mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'export-1',
        createdAt: new Date('2026-02-01T00:00:00Z'),
        ...data,
      }),
    );
    prisma.auditLog.create.mockResolvedValue({} as never);

    const first = await service.export(makeActor(), {
      periodId: 'p-1',
      format: TimesheetExportFormat.CSV,
      mode: TimesheetExportMode.SUMMARY,
    });
    const second = await service.export(makeActor(), {
      periodId: 'p-1',
      format: TimesheetExportFormat.CSV,
      mode: TimesheetExportMode.SUMMARY,
    });

    expect(first.payload.equals(second.payload)).toBe(true);
    expect(first.export.payloadSha256).toBe(second.export.payloadSha256);
  });
});
