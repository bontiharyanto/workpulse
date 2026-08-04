import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataExportRequest } from '@prisma/client';
import { DataExportStatus } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { DataExportService } from './data-export.service';
import { PrismaService } from '../prisma/prisma.service';
import type { StorageProvider } from '../storage/storage.provider';

interface Kit {
  service: DataExportService;
  prisma: DeepMockProxy<PrismaService>;
  storage: DeepMockProxy<StorageProvider>;
}

function buildKit(overrides: Record<string, string> = {}): Kit {
  const prisma = mockDeep<PrismaService>();
  const storage = mockDeep<StorageProvider>();
  mockReset(prisma);
  mockReset(storage);

  const config = {
    get: jest.fn((key: string, def?: string): string | undefined => {
      const env: Record<string, string> = {
        DATA_EXPORT_COOLDOWN_HOURS: '24',
        ...overrides,
      };
      return env[key] ?? def;
    }),
  } as unknown as ConfigService;

  const service = new DataExportService(prisma, storage, config);
  return { service, prisma, storage };
}

function makeRow(overrides: Partial<DataExportRequest> = {}): DataExportRequest {
  return {
    id: 'req-1',
    userId: 'user-1',
    companyId: 'company-1',
    status: DataExportStatus.READY,
    requestedAt: new Date('2026-08-01T00:00:00Z'),
    startedAt: new Date('2026-08-01T00:00:05Z'),
    completedAt: new Date('2026-08-01T00:00:30Z'),
    failedAt: null,
    failureReason: null,
    fileKey: 'data-exports/company-1/user-1/req-1.zip',
    fileSize: 12_345,
    expiresAt: new Date('2026-08-02T00:00:30Z'),
    ...overrides,
  };
}

describe('DataExportService.create', () => {
  it('creates a PENDING row + audit inside a transaction when no other request exists', async () => {
    const { service, prisma } = buildKit();
    prisma.dataExportRequest.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (tx: unknown) => unknown)(prisma);
      }
      throw new Error('unexpected transaction shape');
    });
    const created = makeRow({ status: DataExportStatus.PENDING });
    prisma.dataExportRequest.create.mockResolvedValue(created);

    const out = await service.create('user-1', 'company-1');
    expect(out).toBe(created);
    expect(prisma.dataExportRequest.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        companyId: 'company-1',
        status: DataExportStatus.PENDING,
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'DATA_EXPORT_REQUESTED',
        entityType: 'DataExportRequest',
        entityId: created.id,
        actorId: 'user-1',
        companyId: 'company-1',
      }),
    });
  });

  it('409 EXPORT_ALREADY_PENDING when a PENDING row exists for the user', async () => {
    const { service, prisma } = buildKit();
    prisma.dataExportRequest.findFirst.mockResolvedValueOnce(
      makeRow({ status: DataExportStatus.PENDING }),
    );

    const err = await service.create('user-1', 'company-1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'EXPORT_ALREADY_PENDING',
    });
  });

  it('409 EXPORT_ALREADY_PENDING when a PROCESSING row exists', async () => {
    const { service, prisma } = buildKit();
    prisma.dataExportRequest.findFirst.mockResolvedValueOnce(
      makeRow({ status: DataExportStatus.PROCESSING }),
    );

    const err = await service.create('user-1', 'company-1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
  });

  it('409 EXPORT_COOLDOWN when the last request landed within the cooldown window', async () => {
    const { service, prisma } = buildKit();
    prisma.dataExportRequest.findFirst
      .mockResolvedValueOnce(null) // no in-flight
      .mockResolvedValueOnce(
        makeRow({
          status: DataExportStatus.READY,
          requestedAt: new Date(Date.now() - 3_600_000), // 1 hour ago
        }),
      );

    const err = await service.create('user-1', 'company-1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'EXPORT_COOLDOWN',
    });
  });

  it('accepts the request when the last one is older than the cooldown window', async () => {
    const { service, prisma } = buildKit({ DATA_EXPORT_COOLDOWN_HOURS: '1' });
    prisma.dataExportRequest.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(
      makeRow({
        status: DataExportStatus.READY,
        requestedAt: new Date(Date.now() - 2 * 3_600_000), // 2h ago, cooldown=1h
      }),
    );
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (tx: unknown) => unknown)(prisma);
      }
      throw new Error();
    });
    prisma.dataExportRequest.create.mockResolvedValue(
      makeRow({ status: DataExportStatus.PENDING }),
    );

    await expect(service.create('user-1', 'company-1')).resolves.toBeDefined();
  });
});

describe('DataExportService.getDownloadUrl', () => {
  it('mints a fresh presigned URL for a READY row and audits the mint', async () => {
    const { service, prisma, storage } = buildKit();
    prisma.dataExportRequest.findUnique.mockResolvedValue(makeRow());
    storage.presignGet.mockResolvedValue({
      url: 'https://example.com/signed',
      expiresIn: 900,
    });
    prisma.auditLog.create.mockResolvedValue({} as never);

    const out = await service.getDownloadUrl('user-1', 'req-1');
    expect(out).toEqual({
      downloadUrl: 'https://example.com/signed',
      expiresIn: 900,
    });
    expect(storage.presignGet).toHaveBeenCalledWith({
      key: 'data-exports/company-1/user-1/req-1.zip',
      downloadFilename: 'workpulse-data-export-req-1.zip',
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'DATA_EXPORT_DOWNLOAD_URL_ISSUED',
      }),
    });
  });

  it('404 EXPORT_NOT_FOUND for a foreign row (no existence leak)', async () => {
    const { service, prisma } = buildKit();
    prisma.dataExportRequest.findUnique.mockResolvedValue(makeRow({ userId: 'stranger' }));
    const err = await service.getDownloadUrl('user-1', 'req-1').catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toMatchObject({
      code: 'EXPORT_NOT_FOUND',
    });
  });

  it('409 EXPORT_NOT_READY for a PENDING row', async () => {
    const { service, prisma } = buildKit();
    prisma.dataExportRequest.findUnique.mockResolvedValue(
      makeRow({ status: DataExportStatus.PENDING, fileKey: null }),
    );
    const err = await service.getDownloadUrl('user-1', 'req-1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'EXPORT_NOT_READY',
    });
  });

  it('409 EXPORT_FAILED with the failure reason detail', async () => {
    const { service, prisma } = buildKit();
    prisma.dataExportRequest.findUnique.mockResolvedValue(
      makeRow({
        status: DataExportStatus.FAILED,
        failureReason: 'S3 rejected upload',
        fileKey: null,
      }),
    );
    const err = await service.getDownloadUrl('user-1', 'req-1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'EXPORT_FAILED',
      details: { failureReason: 'S3 rejected upload' },
    });
  });

  it('410 EXPORT_EXPIRED when the row is EXPIRED', async () => {
    const { service, prisma } = buildKit();
    prisma.dataExportRequest.findUnique.mockResolvedValue(
      makeRow({ status: DataExportStatus.EXPIRED, fileKey: null }),
    );
    const err = await service.getDownloadUrl('user-1', 'req-1').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      code: 'EXPORT_EXPIRED',
    });
  });
});

describe('DataExportService.expireOverdue', () => {
  it('flips READY-past-expiresAt rows to EXPIRED and deletes their S3 objects', async () => {
    const { service, prisma, storage } = buildKit();
    const overdue = [
      makeRow({ id: 'a', fileKey: 'k/a.zip' }),
      makeRow({ id: 'b', fileKey: 'k/b.zip' }),
    ];
    prisma.dataExportRequest.findMany.mockResolvedValue(overdue);
    storage.deleteObject.mockResolvedValue(undefined);
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (tx: unknown) => unknown)(prisma);
      }
      throw new Error();
    });

    const out = await service.expireOverdue();
    expect(out).toEqual({ expired: 2 });
    expect(storage.deleteObject).toHaveBeenCalledWith('k/a.zip');
    expect(storage.deleteObject).toHaveBeenCalledWith('k/b.zip');
    expect(prisma.dataExportRequest.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { status: DataExportStatus.EXPIRED, fileKey: null },
    });
  });

  it('still flips the row to EXPIRED even when the S3 delete fails', async () => {
    const { service, prisma, storage } = buildKit();
    prisma.dataExportRequest.findMany.mockResolvedValue([makeRow({ id: 'x' })]);
    storage.deleteObject.mockRejectedValue(new Error('S3 down'));
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (tx: unknown) => unknown)(prisma);
      }
      throw new Error();
    });

    const out = await service.expireOverdue();
    expect(out).toEqual({ expired: 1 });
    expect(prisma.dataExportRequest.update).toHaveBeenCalledWith({
      where: { id: 'x' },
      data: expect.objectContaining({ status: DataExportStatus.EXPIRED }),
    });
  });
});
