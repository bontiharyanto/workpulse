import { ConflictException, NotFoundException } from '@nestjs/common';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { GeofenceService } from './geofence.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';


const hr: AuthenticatedUser = {
  id: 'user-hr',
  email: 'hr@a.test',
  companyId: 'company-1',
  departmentId: null,
  role: 'HR_MANAGER',
};

function makeRow(overrides: Partial<{ id: string; shiftCount: number }> = {}) {
  return {
    id: overrides.id ?? 'gf-1',
    companyId: 'company-1',
    name: 'HQ',
    latitude: -6.2088,
    longitude: 106.8456,
    radiusMeters: 100,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    _count: { shifts: overrides.shiftCount ?? 0 },
  };
}

function setup(): { service: GeofenceService; prisma: DeepMockProxy<PrismaService> } {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  return { service: new GeofenceService(prisma), prisma };
}

function stubTx(prisma: DeepMockProxy<PrismaService>): void {
  type Cb = (tx: PrismaService) => Promise<unknown>;
  prisma.$transaction.mockImplementation(((cb: Cb | unknown) => {
    if (typeof cb === 'function') return (cb as Cb)(prisma);
    return Promise.resolve(cb);
  }) as never);
}

describe('GeofenceService.create', () => {
  it('inserts a tenant-scoped geofence and writes audit log inside a transaction', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.geofence.create.mockResolvedValue({
      id: 'gf-new',
      companyId: 'company-1',
      name: 'Branch A',
      latitude: -6.2 as never,
      longitude: 106.8 as never,
      radiusMeters: 150,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    } as never);
    prisma.geofence.findFirst.mockResolvedValue(makeRow({ id: 'gf-new' }) as never);

    const dto = await service.create(hr, {
      name: '  Branch A ',
      latitude: -6.2,
      longitude: 106.8,
      radiusMeters: 150,
    });

    expect(prisma.geofence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          name: 'Branch A',
          radiusMeters: 150,
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'GEOFENCE_CREATED', entityId: 'gf-new' }),
      }),
    );
    expect(dto.name).toBe('HQ'); // from stubbed findFirst → dto
  });
});

describe('GeofenceService.remove', () => {
  it('refuses to delete a geofence still referenced by shifts', async () => {
    const { service, prisma } = setup();
    prisma.geofence.findFirst.mockResolvedValue(makeRow({ shiftCount: 2 }) as never);
    await expect(service.remove(hr, 'gf-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('soft-deletes when no shifts reference it', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.geofence.findFirst.mockResolvedValue(makeRow() as never);
    prisma.geofence.update.mockResolvedValue({
      ...makeRow(),
      deletedAt: new Date(),
    } as never);

    await service.remove(hr, 'gf-1');

    expect(prisma.geofence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'gf-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'GEOFENCE_DELETED' }),
      }),
    );
  });

  it('throws NotFound for cross-tenant lookup', async () => {
    const { service, prisma } = setup();
    prisma.geofence.findFirst.mockResolvedValue(null as never);
    await expect(service.remove(hr, 'gf-other')).rejects.toBeInstanceOf(NotFoundException);
  });
});
