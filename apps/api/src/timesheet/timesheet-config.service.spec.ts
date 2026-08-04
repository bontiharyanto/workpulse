import { BadRequestException } from '@nestjs/common';
import {
  TimesheetConfig,
  TimesheetPeriodType,
  WeekStartDay,
} from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { PrismaService } from '../prisma/prisma.service';

import { TimesheetConfigService } from './timesheet-config.service';

interface Kit {
  service: TimesheetConfigService;
  prisma: DeepMockProxy<PrismaService>;
}

function buildKit(): Kit {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  return { service: new TimesheetConfigService(prisma), prisma };
}

function makeConfig(
  overrides: Partial<TimesheetConfig> = {},
): TimesheetConfig {
  return {
    id: 'tc-1',
    companyId: 'c-1',
    periodType: TimesheetPeriodType.MONTHLY,
    weekStartDay: WeekStartDay.MONDAY,
    biweeklyAnchor: null,
    cutoffDayOfMonth: null,
    timezone: 'Asia/Jakarta',
    autoGenerateEnabled: true,
    reminderEnabled: true,
    submitReminderStartDays: 1,
    submitReminderMaxDays: 7,
    approvalReminderStartDays: 2,
    approvalReminderMaxDays: 14,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    updatedById: null,
    ...overrides,
  };
}

describe('TimesheetConfigService.getForCompany', () => {
  it('returns existing config without upserting', async () => {
    const { service, prisma } = buildKit();
    const row = makeConfig();
    prisma.timesheetConfig.findUnique.mockResolvedValue(row);

    const result = await service.getForCompany('c-1');

    expect(result).toBe(row);
    expect(prisma.timesheetConfig.upsert).not.toHaveBeenCalled();
  });

  it('lazily creates a default config on first read', async () => {
    const { service, prisma } = buildKit();
    prisma.timesheetConfig.findUnique.mockResolvedValue(null);
    prisma.timesheetConfig.upsert.mockResolvedValue(makeConfig());

    const result = await service.getForCompany('c-1');

    expect(result.periodType).toBe(TimesheetPeriodType.MONTHLY);
    expect(prisma.timesheetConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'c-1' },
        create: { companyId: 'c-1' },
      }),
    );
  });
});

describe('TimesheetConfigService.update', () => {
  it('rejects cutoffDayOfMonth out of range', async () => {
    const { service } = buildKit();
    await expect(
      service.update(
        { id: 'u-1', companyId: 'c-1' },
        { cutoffDayOfMonth: 30 },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects invalid timezone', async () => {
    const { service } = buildKit();
    await expect(
      service.update(
        { id: 'u-1', companyId: 'c-1' },
        { timezone: 'Mars/Olympus' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects biweeklyAnchor not matching YYYY-MM-DD', async () => {
    const { service } = buildKit();
    await expect(
      service.update(
        { id: 'u-1', companyId: 'c-1' },
        { biweeklyAnchor: '2026/08/03' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects CUTOFF period type without cutoffDayOfMonth', async () => {
    const { service, prisma } = buildKit();
    const existing = makeConfig({ cutoffDayOfMonth: null });
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (t: unknown) => unknown)({
          timesheetConfig: {
            upsert: jest.fn().mockResolvedValue(existing),
            update: jest.fn().mockResolvedValue(existing),
          },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
        });
      }
      return undefined;
    });

    await expect(
      service.update(
        { id: 'u-1', companyId: 'c-1' },
        { periodType: TimesheetPeriodType.CUTOFF },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('applies partial update + emits audit log', async () => {
    const { service, prisma } = buildKit();
    const before = makeConfig();
    const after = makeConfig({
      periodType: TimesheetPeriodType.CUTOFF,
      cutoffDayOfMonth: 25,
      updatedById: 'u-1',
    });
    const upsert = jest.fn().mockResolvedValue(before);
    const update = jest.fn().mockResolvedValue(after);
    const auditCreate = jest.fn().mockResolvedValue({});
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (t: unknown) => unknown)({
          timesheetConfig: { upsert, update },
          auditLog: { create: auditCreate },
        });
      }
      return undefined;
    });

    const result = await service.update(
      { id: 'u-1', companyId: 'c-1' },
      {
        periodType: TimesheetPeriodType.CUTOFF,
        cutoffDayOfMonth: 25,
      },
    );

    expect(result).toBe(after);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'TIMESHEET_CONFIG_UPDATED',
          companyId: 'c-1',
          actorId: 'u-1',
        }),
      }),
    );
  });
});
