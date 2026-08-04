import { ConflictException, NotFoundException } from '@nestjs/common';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { HolidayService } from './holiday.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';


const hr: AuthenticatedUser = {
  id: 'user-hr',
  email: 'hr@a.test',
  companyId: 'company-1',
  departmentId: null,
  role: 'HR_MANAGER',
};

function makeRow(overrides: Partial<{ id: string; date: string; name: string }> = {}) {
  return {
    id: overrides.id ?? 'h-1',
    companyId: 'company-1',
    date: new Date(`${overrides.date ?? '2026-01-01'}T00:00:00.000Z`),
    name: overrides.name ?? 'Tahun Baru',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function setup(): { service: HolidayService; prisma: DeepMockProxy<PrismaService> } {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  return { service: new HolidayService(prisma), prisma };
}

function stubTx(prisma: DeepMockProxy<PrismaService>): void {
  type Cb = (tx: PrismaService) => Promise<unknown>;
  prisma.$transaction.mockImplementation(((cb: Cb | unknown) => {
    if (typeof cb === 'function') return (cb as Cb)(prisma);
    return Promise.resolve(cb);
  }) as never);
}

describe('HolidayService.list', () => {
  it('scopes by companyId and returns rows in ascending date order', async () => {
    const { service, prisma } = setup();
    prisma.holiday.findMany.mockResolvedValue([
      makeRow({ id: 'a', date: '2026-01-01', name: 'Tahun Baru' }),
      makeRow({ id: 'b', date: '2026-05-01', name: 'Hari Buruh' }),
    ] as never);

    const rows = await service.list(hr);
    expect(prisma.holiday.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-1' },
        orderBy: { date: 'asc' },
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-01-01', name: 'Tahun Baru' });
  });

  it('applies year filter as half-open interval [Jan 1, Jan 1 next year)', async () => {
    const { service, prisma } = setup();
    prisma.holiday.findMany.mockResolvedValue([] as never);
    await service.list(hr, 2026);
    expect(prisma.holiday.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          date: {
            gte: new Date('2026-01-01T00:00:00.000Z'),
            lt: new Date('2027-01-01T00:00:00.000Z'),
          },
        }),
      }),
    );
  });
});

describe('HolidayService.create', () => {
  it('inserts + audit-logs within one transaction', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.holiday.create.mockResolvedValue(
      makeRow({ id: 'h-new', date: '2026-08-17', name: 'Kemerdekaan RI' }) as never,
    );

    const dto = await service.create(hr, { date: '2026-08-17', name: '  Kemerdekaan RI ' });

    expect(prisma.holiday.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          date: new Date('2026-08-17T00:00:00.000Z'),
          name: 'Kemerdekaan RI',
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'HOLIDAY_CREATED', entityId: 'h-new' }),
      }),
    );
    expect(dto).toMatchObject({ date: '2026-08-17', name: 'Kemerdekaan RI' });
  });

  it('maps unique (companyId, date) violation to HOLIDAY_DATE_TAKEN', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.holiday.create.mockRejectedValue({ code: 'P2002' } as never);
    await expect(
      service.create(hr, { date: '2026-01-01', name: 'Duplicate' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('HolidayService.update', () => {
  it('rejects cross-tenant lookup with NotFound', async () => {
    const { service, prisma } = setup();
    prisma.holiday.findFirst.mockResolvedValue(null as never);
    await expect(service.update(hr, 'other-h', { name: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('writes before/after audit for a rename', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.holiday.findFirst.mockResolvedValue(makeRow() as never);
    prisma.holiday.update.mockResolvedValue(makeRow({ name: 'Tahun Baru Masehi' }) as never);

    await service.update(hr, 'h-1', { name: 'Tahun Baru Masehi' });

    expect(prisma.holiday.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'h-1' },
        data: expect.objectContaining({ name: 'Tahun Baru Masehi' }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'HOLIDAY_UPDATED' }),
      }),
    );
  });
});

describe('HolidayService.remove', () => {
  it('hard-deletes + audit-logs the beforeJson', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.holiday.findFirst.mockResolvedValue(makeRow() as never);
    prisma.holiday.delete.mockResolvedValue(makeRow() as never);

    await service.remove(hr, 'h-1');

    expect(prisma.holiday.delete).toHaveBeenCalledWith({ where: { id: 'h-1' } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'HOLIDAY_DELETED',
          beforeJson: expect.anything(),
        }),
      }),
    );
  });
});

describe('HolidayService.bulkImport', () => {
  it('dedupes duplicate dates in the payload before insert', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.holiday.createMany.mockResolvedValue({ count: 2 } as never);

    const res = await service.bulkImport(hr, [
      { date: '2026-01-01', name: 'Tahun Baru' },
      { date: '2026-05-01', name: 'Hari Buruh' },
      { date: '2026-01-01', name: 'Tahun Baru (dupe)' }, // deduped locally
    ]);

    expect(prisma.holiday.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [
          expect.objectContaining({ name: 'Tahun Baru' }),
          expect.objectContaining({ name: 'Hari Buruh' }),
        ],
      }),
    );
    expect(res).toEqual({ inserted: 2, skipped: 0 });
  });

  it('reports skipped count when DB skipDuplicates omits existing rows', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.holiday.createMany.mockResolvedValue({ count: 1 } as never);

    const res = await service.bulkImport(hr, [
      { date: '2026-01-01', name: 'Tahun Baru' },
      { date: '2026-05-01', name: 'Hari Buruh' },
    ]);
    expect(res).toEqual({ inserted: 1, skipped: 1 });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'HOLIDAY_BULK_IMPORTED',
        }),
      }),
    );
  });
});
