import type { ConfigService } from '@nestjs/config';
import type { DataExportRequest } from '@prisma/client';
import { DataExportStatus } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { PrismaService } from '../prisma/prisma.service';
import type { StorageProvider } from '../storage/storage.provider';

import type { DataExportService } from './data-export.service';
import { DataExportWorker } from './data-export.worker';

// Mock the assembler so the worker specs don't depend on the ZIP
// implementation — that has its own suite. Deliberately returns a
// stable 3-byte buffer so we can assert size + upload wiring.
jest.mock('./domain/assemble-export', () => ({
  assembleExportArchive: jest.fn(async () => ({
    buffer: Buffer.from([0x50, 0x4b, 0x03]),
    size: 3,
    fileCount: 1,
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const assembleModule = require('./domain/assemble-export') as {
  assembleExportArchive: jest.Mock;
};

interface Kit {
  worker: DataExportWorker;
  prisma: DeepMockProxy<PrismaService>;
  storage: DeepMockProxy<StorageProvider>;
  service: DeepMockProxy<DataExportService>;
}

function buildKit(overrides: Record<string, string> = {}): Kit {
  const prisma = mockDeep<PrismaService>();
  const storage = mockDeep<StorageProvider>();
  const service = mockDeep<DataExportService>();
  mockReset(prisma);
  mockReset(storage);
  mockReset(service);
  assembleModule.assembleExportArchive.mockClear();

  const config = {
    get: jest.fn((key: string, def?: string): string | undefined => {
      const env: Record<string, string> = {
        DATA_EXPORT_WORKER_ENABLED: 'true',
        ...overrides,
      };
      return env[key] ?? def;
    }),
  } as unknown as ConfigService;

  const worker = new DataExportWorker(prisma, storage, service, config);
  return { worker, prisma, storage, service };
}

function makePending(id = 'req-1'): DataExportRequest {
  return {
    id,
    userId: 'user-1',
    companyId: 'company-1',
    status: DataExportStatus.PENDING,
    requestedAt: new Date('2026-08-01T00:00:00Z'),
    startedAt: null,
    completedAt: null,
    failedAt: null,
    failureReason: null,
    fileKey: null,
    fileSize: null,
    expiresAt: null,
  };
}

describe('DataExportWorker.tick', () => {
  it('claims a PENDING row via SELECT ... FOR UPDATE SKIP LOCKED and marks it PROCESSING', async () => {
    const { worker, prisma } = buildKit();
    prisma.$transaction.mockImplementationOnce(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (tx: unknown) => unknown)(prisma);
      }
      throw new Error();
    });
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'req-1' }] as never);
    prisma.dataExportRequest.update.mockResolvedValueOnce({
      ...makePending('req-1'),
      status: DataExportStatus.PROCESSING,
      startedAt: new Date(),
    });
    // second claim returns empty → stop looping
    prisma.$transaction.mockImplementationOnce(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (tx: unknown) => unknown)(prisma);
      }
      throw new Error();
    });
    prisma.$queryRawUnsafe.mockResolvedValueOnce([] as never);

    // stub the "process" side so we don't need to wire the full
    // update/audit chain; we just verify claim happened.
    prisma.dataExportRequest.update.mockResolvedValue({} as never);
    prisma.auditLog.create.mockResolvedValue({} as never);

    await worker.tick();

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE SKIP LOCKED'),
    );
  });

  it('no-ops when DATA_EXPORT_WORKER_ENABLED=false', async () => {
    const { worker, prisma } = buildKit({ DATA_EXPORT_WORKER_ENABLED: 'false' });
    await worker.tick();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('processes a claimed job end-to-end: assemble → upload → READY + audit', async () => {
    const { worker, prisma, storage } = buildKit();
    const claimed: DataExportRequest = {
      ...makePending('req-2'),
      status: DataExportStatus.PROCESSING,
      startedAt: new Date(),
    };
    // First tick: claim returns the row.
    prisma.$transaction
      .mockImplementationOnce(async (cb: unknown) => {
        if (typeof cb === 'function') {
          return (cb as (tx: unknown) => unknown)(prisma);
        }
        throw new Error();
      })
      .mockImplementationOnce(async (cb: unknown) => {
        if (typeof cb === 'function') {
          return (cb as (tx: unknown) => unknown)(prisma);
        }
        throw new Error();
      })
      .mockImplementationOnce(async (cb: unknown) => {
        if (typeof cb === 'function') {
          return (cb as (tx: unknown) => unknown)(prisma);
        }
        throw new Error();
      });
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ id: 'req-2' }] as never)
      .mockResolvedValueOnce([] as never);
    prisma.dataExportRequest.update
      .mockResolvedValueOnce(claimed) // claim: PENDING → PROCESSING
      .mockResolvedValueOnce({ ...claimed, status: DataExportStatus.READY }); // completion
    storage.putObject.mockResolvedValue(undefined);
    prisma.auditLog.create.mockResolvedValue({} as never);

    await worker.tick();

    expect(assembleModule.assembleExportArchive).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'user-1',
        companyId: 'company-1',
        requestId: 'req-2',
      }),
    );
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'data-exports/company-1/user-1/req-2.zip',
        contentType: 'application/zip',
        contentLength: 3,
      }),
    );
    expect(prisma.dataExportRequest.update).toHaveBeenLastCalledWith({
      where: { id: 'req-2' },
      data: expect.objectContaining({
        status: DataExportStatus.READY,
        fileKey: 'data-exports/company-1/user-1/req-2.zip',
        fileSize: 3,
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'DATA_EXPORT_COMPLETED' }),
    });
  });

  it('flips the row to FAILED with a truncated reason when assembly throws', async () => {
    const { worker, prisma } = buildKit();
    const claimed = {
      ...makePending('req-3'),
      status: DataExportStatus.PROCESSING,
      startedAt: new Date(),
    };
    prisma.$transaction
      .mockImplementationOnce(async (cb: unknown) => {
        if (typeof cb === 'function') {
          return (cb as (tx: unknown) => unknown)(prisma);
        }
        throw new Error();
      })
      .mockImplementationOnce(async (cb: unknown) => {
        if (typeof cb === 'function') {
          return (cb as (tx: unknown) => unknown)(prisma);
        }
        throw new Error();
      });
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ id: 'req-3' }] as never)
      .mockResolvedValueOnce([] as never);
    prisma.dataExportRequest.update.mockResolvedValueOnce(claimed);
    prisma.auditLog.create.mockResolvedValue({} as never);
    assembleModule.assembleExportArchive.mockRejectedValueOnce(new Error('boom during snapshot'));

    await worker.tick();

    expect(prisma.dataExportRequest.update).toHaveBeenLastCalledWith({
      where: { id: 'req-3' },
      data: expect.objectContaining({
        status: DataExportStatus.FAILED,
        failureReason: 'boom during snapshot',
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ action: 'DATA_EXPORT_FAILED' }),
    });
  });
});
