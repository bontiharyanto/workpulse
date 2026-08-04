import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import { CompanyService } from './company.service';

const hr: AuthenticatedUser = {
  id: 'u-1',
  email: 'hr@acme.test',
  companyId: 'co-1',
  departmentId: null,
  role: 'HR_MANAGER',
};

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'co-1',
    name: 'Acme',
    slug: 'acme',
    timezone: 'Asia/Jakarta',
    overtimeHourlyRate: new Prisma.Decimal('50000.00'),
    overtimeWeekdayMultiplier: new Prisma.Decimal('1.5'),
    overtimeWeekendMultiplier: new Prisma.Decimal('2.0'),
    overtimeHolidayMultiplier: new Prisma.Decimal('3.0'),
    overtimeMaxHoursPerDay: new Prisma.Decimal('4.0'),
    overtimeSubmitWindowDays: 14,
    overtimeCompleteGraceDays: 2,
    payrollLockedUntil: null,
    ...overrides,
  };
}

function setup(): { service: CompanyService; prisma: DeepMockProxy<PrismaService> } {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  return { service: new CompanyService(prisma), prisma };
}

function stubTx(prisma: DeepMockProxy<PrismaService>): void {
  type Cb = (tx: PrismaService) => Promise<unknown>;
  prisma.$transaction.mockImplementation(((cb: Cb | unknown) => {
    if (typeof cb === 'function') return (cb as Cb)(prisma);
    return Promise.resolve(cb);
  }) as never);
}

describe('CompanyService.getConfig', () => {
  it('returns the caller\u2019s tenant config with Decimal fields coerced to number', async () => {
    const { service, prisma } = setup();
    prisma.company.findFirst.mockResolvedValueOnce(makeRow() as never);

    const result = await service.getConfig(hr);

    expect(prisma.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'co-1', deletedAt: null } }),
    );
    expect(result).toEqual({
      id: 'co-1',
      name: 'Acme',
      slug: 'acme',
      timezone: 'Asia/Jakarta',
      overtimeHourlyRate: 50000,
      overtimeWeekdayMultiplier: 1.5,
      overtimeWeekendMultiplier: 2,
      overtimeHolidayMultiplier: 3,
      overtimeMaxHoursPerDay: 4,
      overtimeSubmitWindowDays: 14,
      overtimeCompleteGraceDays: 2,
      payrollLockedUntil: null,
    });
  });

  it('serialises a null base rate faithfully', async () => {
    const { service, prisma } = setup();
    prisma.company.findFirst.mockResolvedValueOnce(
      makeRow({ overtimeHourlyRate: null }) as never,
    );
    const result = await service.getConfig(hr);
    expect(result.overtimeHourlyRate).toBeNull();
  });

  it('throws NotFound when tenant is soft-deleted', async () => {
    const { service, prisma } = setup();
    prisma.company.findFirst.mockResolvedValueOnce(null);
    await expect(service.getConfig(hr)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CompanyService.updateConfig', () => {
  it('rejects an empty patch body', async () => {
    const { service } = setup();
    await expect(service.updateConfig(hr, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invalid timezone before touching the DB', async () => {
    const { service, prisma } = setup();
    await expect(service.updateConfig(hr, { timezone: 'Asia/Jkt' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_TIMEZONE' }),
    });
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('persists changed fields and writes an audit log with before/after diff', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.company.findFirst.mockResolvedValueOnce(makeRow() as never);
    prisma.company.update.mockResolvedValueOnce(
      makeRow({
        overtimeHourlyRate: new Prisma.Decimal('75000.00'),
        overtimeCompleteGraceDays: 5,
      }) as never,
    );

    const dto = await service.updateConfig(hr, {
      overtimeHourlyRate: 75_000,
      overtimeCompleteGraceDays: 5,
    });

    expect(dto.overtimeHourlyRate).toBe(75_000);
    expect(dto.overtimeCompleteGraceDays).toBe(5);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'COMPANY_CONFIG_UPDATED',
          entityType: 'Company',
          entityId: 'co-1',
          beforeJson: { overtimeHourlyRate: 50000, overtimeCompleteGraceDays: 2 },
          afterJson: { overtimeHourlyRate: 75000, overtimeCompleteGraceDays: 5 },
        }),
      }),
    );
  });

  it('allows clearing the base rate by passing null', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.company.findFirst.mockResolvedValueOnce(makeRow() as never);
    prisma.company.update.mockResolvedValueOnce(
      makeRow({ overtimeHourlyRate: null }) as never,
    );

    const dto = await service.updateConfig(hr, { overtimeHourlyRate: null });

    expect(dto.overtimeHourlyRate).toBeNull();
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { overtimeHourlyRate: null } }),
    );
  });

  it('skips the audit log when the patch is a no-op replay of current values', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.company.findFirst.mockResolvedValueOnce(makeRow() as never);
    prisma.company.update.mockResolvedValueOnce(makeRow() as never);

    await service.updateConfig(hr, { overtimeCompleteGraceDays: 2 });

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('trims whitespace on string fields', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.company.findFirst.mockResolvedValueOnce(makeRow() as never);
    prisma.company.update.mockResolvedValueOnce(makeRow({ name: 'Acme Corp' }) as never);

    await service.updateConfig(hr, { name: '  Acme Corp  ' });

    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Acme Corp' } }),
    );
  });

  it('scopes strictly to the caller companyId (cannot cross tenants)', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.company.findFirst.mockResolvedValueOnce(null);

    await expect(service.updateConfig(hr, { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('sets payrollLockedUntil from an ISO date string', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.company.findFirst.mockResolvedValueOnce(makeRow() as never);
    prisma.company.update.mockResolvedValueOnce(
      makeRow({ payrollLockedUntil: new Date('2026-07-31T00:00:00Z') }) as never,
    );

    const dto = await service.updateConfig(hr, { payrollLockedUntil: '2026-07-31' });

    expect(dto.payrollLockedUntil).toBe('2026-07-31');
    const updateCall = prisma.company.update.mock.calls[0]?.[0] as
      | { data: { payrollLockedUntil?: Date | null } }
      | undefined;
    expect(updateCall?.data.payrollLockedUntil).toBeInstanceOf(Date);
    expect(updateCall?.data.payrollLockedUntil?.toISOString().slice(0, 10)).toBe(
      '2026-07-31',
    );
  });

  it('clears payrollLockedUntil when null is passed explicitly', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.company.findFirst.mockResolvedValueOnce(
      makeRow({ payrollLockedUntil: new Date('2026-07-31T00:00:00Z') }) as never,
    );
    prisma.company.update.mockResolvedValueOnce(
      makeRow({ payrollLockedUntil: null }) as never,
    );

    const dto = await service.updateConfig(hr, { payrollLockedUntil: null });

    expect(dto.payrollLockedUntil).toBeNull();
    const updateCall = prisma.company.update.mock.calls[0]?.[0] as
      | { data: { payrollLockedUntil: Date | null } }
      | undefined;
    expect(updateCall?.data.payrollLockedUntil).toBeNull();
  });

  it('rejects a malformed payrollLockedUntil (not YYYY-MM-DD)', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.company.findFirst.mockResolvedValueOnce(makeRow() as never);

    await expect(
      service.updateConfig(hr, { payrollLockedUntil: 'not-a-date' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_DATE' }),
    });
    expect(prisma.company.update).not.toHaveBeenCalled();
  });
});
