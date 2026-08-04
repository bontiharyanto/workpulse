import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { TimesheetExportFormat, TimesheetExportMode } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import type { WebhookDispatcher } from '../webhook/webhook-dispatcher.service';
import { sign } from './domain/share-signature';
import { TimesheetExportShareService } from './timesheet-export-share.service';
import type { ExportResult, TimesheetExportService } from './timesheet-export.service';

const SECRET = 'z'.repeat(48);

interface Kit {
  service: TimesheetExportShareService;
  prisma: DeepMockProxy<PrismaService>;
  exportService: { loadPayloadForShare: jest.Mock };
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
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'TIMESHEET_EXPORT_SIGNING_SECRET') return SECRET;
      if (key === 'TIMESHEET_EXPORT_SHARE_TTL_HOURS') return 24;
      if (key === 'PUBLIC_API_URL') return 'https://api.example.com';
      return fallback;
    }),
  } as unknown as ConfigService;
  const exportService = {
    loadPayloadForShare: jest.fn(),
  };
  const webhookDispatcher = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const service = new TimesheetExportShareService(
    prisma as unknown as PrismaService,
    config,
    exportService as unknown as TimesheetExportService,
    webhookDispatcher as unknown as WebhookDispatcher,
  );
  service.onModuleInit();
  return { service, prisma, exportService, webhookDispatcher };
}

function makeActor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'hr-1',
    companyId: 'c-1',
    departmentId: null,
    email: 'hr@example.com',
    role: 'HR_MANAGER',
    ...overrides,
  };
}

describe('TimesheetExportShareService.create (Fase 32d)', () => {
  it('refuses non-HR actors', async () => {
    const { service } = buildKit();
    await expect(
      service.create(makeActor({ role: 'EMPLOYEE' }), 'export-1', {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses when the export does not belong to the actor tenant', async () => {
    const { service, prisma } = buildKit();
    prisma.timesheetExport.findFirst.mockResolvedValue(null as never);
    await expect(service.create(makeActor(), 'export-1', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses out-of-range ttlHours', async () => {
    const { service, prisma } = buildKit();
    prisma.timesheetExport.findFirst.mockResolvedValue({ id: 'export-1' } as never);
    await expect(service.create(makeActor(), 'export-1', { ttlHours: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.create(makeActor(), 'export-1', { ttlHours: 999 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('creates a share row and returns a signed URL that verifies', async () => {
    const { service, prisma } = buildKit();
    prisma.timesheetExport.findFirst.mockResolvedValue({ id: 'export-1' } as never);
    (prisma.timesheetExportShare.create as unknown as jest.Mock).mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'share-1',
        createdAt: new Date('2026-02-01T00:00:00Z'),
        ...data,
      }),
    );
    prisma.auditLog.create.mockResolvedValue({} as never);

    const share = await service.create(makeActor(), 'export-1', {
      ttlHours: 24,
      note: 'vendor A',
    });
    expect(share.url).toContain('https://api.example.com/api/v1/public/timesheet-exports/download');
    const url = new URL(share.url);
    expect(url.searchParams.get('id')).toBe('share-1');
    expect(url.searchParams.get('expires')).toBe(String(share.expiresAt.getTime()));
    const expected = sign(SECRET, {
      shareId: 'share-1',
      expiresAtMs: share.expiresAt.getTime(),
    });
    expect(url.searchParams.get('signature')).toBe(expected);
  });
});

describe('TimesheetExportShareService.verifyAndDownload (Fase 32d)', () => {
  const shareId = 'share-1';
  const expiresAtMs = Date.now() + 3_600_000;
  const goodSignature = sign(SECRET, { shareId, expiresAtMs });

  const validShareRow = {
    id: shareId,
    exportId: 'export-1',
    companyId: 'c-1',
    createdById: 'hr-1',
    revokedAt: null,
    revokedById: null,
    downloadCount: 0,
    lastDownloadedAt: null,
    note: null,
    expiresAt: new Date(expiresAtMs),
    createdAt: new Date(),
    export: {
      id: 'export-1',
      companyId: 'c-1',
      payloadSha256: 'abc123',
    },
  };

  const goodExportResult: ExportResult = {
    export: {
      id: 'export-1',
      createdAt: new Date(),
      format: TimesheetExportFormat.CSV,
      mode: TimesheetExportMode.SUMMARY,
      rowCount: 1,
      entryCount: 0,
      bytes: 4,
      payloadSha256: 'abc123',
    },
    filename: 'payroll-2026-01-summary.csv',
    contentType: 'text/csv; charset=utf-8',
    payload: Buffer.from('csv!'),
  };

  it('refuses an invalid signature', async () => {
    const { service } = buildKit();
    await expect(
      service.verifyAndDownload(shareId, expiresAtMs, 'wrong-sig'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses when the share row is missing', async () => {
    const { service, prisma } = buildKit();
    prisma.timesheetExportShare.findUnique.mockResolvedValue(null as never);
    await expect(
      service.verifyAndDownload(shareId, expiresAtMs, goodSignature),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a revoked share row', async () => {
    const { service, prisma } = buildKit();
    prisma.timesheetExportShare.findUnique.mockResolvedValue({
      ...validShareRow,
      revokedAt: new Date(),
    } as never);
    await expect(
      service.verifyAndDownload(shareId, expiresAtMs, goodSignature),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses when the DB expiry does not match the signed expiry', async () => {
    const { service, prisma } = buildKit();
    prisma.timesheetExportShare.findUnique.mockResolvedValue({
      ...validShareRow,
      expiresAt: new Date(expiresAtMs + 1),
    } as never);
    await expect(
      service.verifyAndDownload(shareId, expiresAtMs, goodSignature),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('delivers the payload and increments downloadCount on success', async () => {
    const { service, prisma, exportService } = buildKit();
    prisma.timesheetExportShare.findUnique.mockResolvedValue(validShareRow as never);
    exportService.loadPayloadForShare.mockResolvedValue(goodExportResult);
    prisma.timesheetExportShare.update.mockResolvedValue({} as never);
    prisma.auditLog.create.mockResolvedValue({} as never);

    const out = await service.verifyAndDownload(shareId, expiresAtMs, goodSignature, '203.0.113.1');
    expect(out.result).toBe(goodExportResult);
    expect(prisma.timesheetExportShare.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: shareId },
        data: expect.objectContaining({
          downloadCount: { increment: 1 },
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'TIMESHEET_EXPORT_SHARE_DOWNLOADED',
          actorId: null,
        }),
      }),
    );
  });
});
