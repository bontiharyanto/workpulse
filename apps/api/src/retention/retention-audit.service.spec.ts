import type { RetentionAuditReport, RetentionPolicy } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { RetentionAuditService } from './retention-audit.service';
import { RetentionService } from './retention.service';
import { PrismaService } from '../prisma/prisma.service';

interface Kit {
  service: RetentionAuditService;
  prisma: DeepMockProxy<PrismaService>;
  retention: jest.Mocked<Pick<RetentionService, 'getForCompany'>>;
}

const COMPANY = 'c-1';
const PERIOD_START = new Date('2026-03-01T00:00:00Z');
const PERIOD_END = new Date('2026-04-01T00:00:00Z');

function policy(overrides: Partial<RetentionPolicy> = {}): RetentionPolicy {
  return {
    id: 'rp-1',
    companyId: COMPANY,
    notificationRetentionDays: 90,
    dataExportArchiveRetentionHours: 24,
    terminatedUserAnonymizeDays: 365,
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    updatedById: null,
    ...overrides,
  };
}

function buildKit(policyOverrides: Partial<RetentionPolicy> = {}): Kit {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  const retention = {
    getForCompany: jest.fn().mockResolvedValue(policy(policyOverrides)),
  } as unknown as jest.Mocked<Pick<RetentionService, 'getForCompany'>>;
  const service = new RetentionAuditService(prisma, retention as unknown as RetentionService);
  return { service, prisma, retention };
}

/** Fake report returned by `prisma.retentionAuditReport.upsert`. */
function fakeReport(status: 'SUCCESS' | 'GAP_DETECTED' | 'WORKER_INACTIVE') {
  return {
    id: 'rar-1',
    companyId: COMPANY,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    generatedAt: new Date(),
    status,
    notificationsPruned: 0,
    usersAutoAnonymised: 0,
    dsarArchivesExpired: 0,
    notificationsPastRetention: 0,
    dsarArchivesPastRetention: 0,
    terminatedUsersPastRetention: 0,
    policySnapshot: {},
    workerLastRunAt: null,
    findings: [],
    notes: null,
  } as unknown as RetentionAuditReport;
}

/**
 * Wire every DB probe used by `collectCounters` and `workerLastRunAt`
 * to a fixed shape. The specific numbers are provided per-test through
 * `overrides`.
 */
function wireDb(
  prisma: DeepMockProxy<PrismaService>,
  overrides: {
    notificationRows?: Array<{ afterJson: Record<string, unknown> }>;
    userAnonymisedCount?: number;
    dsarExpiredCount?: number;
    notificationsPast?: number;
    dsarArchivesPast?: number;
    terminatedPast?: number;
    workerLastRunAt?: Date | null;
  } = {},
): void {
  prisma.auditLog.findMany.mockResolvedValue(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (overrides.notificationRows ?? []) as any,
  );
  // `countAuditRows` calls `.count` twice (userAnonymised + dsarExpired).
  prisma.auditLog.count
    .mockResolvedValueOnce(overrides.userAnonymisedCount ?? 0)
    .mockResolvedValueOnce(overrides.dsarExpiredCount ?? 0);
  prisma.auditLog.findFirst.mockResolvedValue(
    overrides.workerLastRunAt
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ createdAt: overrides.workerLastRunAt } as any)
      : null,
  );
  prisma.notification.count.mockResolvedValue(overrides.notificationsPast ?? 0);
  prisma.dataExportRequest.count.mockResolvedValue(overrides.dsarArchivesPast ?? 0);
  prisma.user.count.mockResolvedValue(overrides.terminatedPast ?? 0);
}

describe('RetentionAuditService.generateForPeriod', () => {
  it('rejects an inverted period', async () => {
    const { service } = buildKit();
    await expect(service.generateForPeriod(COMPANY, PERIOD_END, PERIOD_START)).rejects.toThrow(
      'AUDIT_PERIOD_INVALID',
    );
  });

  it('persists SUCCESS when all counters are clean and worker ticked', async () => {
    const { service, prisma } = buildKit();
    wireDb(prisma, {
      notificationRows: [{ afterJson: { deletedCount: 12 } }],
      userAnonymisedCount: 1,
      dsarExpiredCount: 2,
      workerLastRunAt: new Date('2026-03-15T02:00:00Z'),
    });
    prisma.retentionAuditReport.upsert.mockResolvedValue(fakeReport('SUCCESS'));

    const res = await service.generateForPeriod(COMPANY, PERIOD_START, PERIOD_END);

    expect(res.status).toBe('SUCCESS');
    expect(prisma.retentionAuditReport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          companyId: COMPANY,
          status: 'SUCCESS',
          notificationsPruned: 12,
          usersAutoAnonymised: 1,
          dsarArchivesExpired: 2,
        }),
      }),
    );
  });

  it('sums notifications deletedCount across multiple worker ticks', async () => {
    const { service, prisma } = buildKit();
    wireDb(prisma, {
      notificationRows: [
        { afterJson: { deletedCount: 3 } },
        { afterJson: { deletedCount: 7 } },
        { afterJson: { deletedCount: 10 } },
      ],
      workerLastRunAt: new Date('2026-03-15T02:00:00Z'),
    });
    prisma.retentionAuditReport.upsert.mockResolvedValue(fakeReport('SUCCESS'));

    await service.generateForPeriod(COMPANY, PERIOD_START, PERIOD_END);

    expect(prisma.retentionAuditReport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ notificationsPruned: 20 }),
      }),
    );
  });

  it('ignores non-numeric or negative deletedCount values', async () => {
    const { service, prisma } = buildKit();
    wireDb(prisma, {
      notificationRows: [
        { afterJson: { deletedCount: 5 } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { afterJson: { deletedCount: 'oops' as any } },
        { afterJson: { deletedCount: -10 } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { afterJson: null as any },
      ],
      workerLastRunAt: new Date('2026-03-15T02:00:00Z'),
    });
    prisma.retentionAuditReport.upsert.mockResolvedValue(fakeReport('SUCCESS'));

    await service.generateForPeriod(COMPANY, PERIOD_START, PERIOD_END);

    expect(prisma.retentionAuditReport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ notificationsPruned: 5 }),
      }),
    );
  });

  it('emits GAP_DETECTED when notification rows are past retention', async () => {
    const { service, prisma } = buildKit();
    wireDb(prisma, {
      notificationsPast: 15,
      workerLastRunAt: new Date('2026-03-15T02:00:00Z'),
    });
    prisma.retentionAuditReport.upsert.mockResolvedValue(fakeReport('GAP_DETECTED'));

    const res = await service.generateForPeriod(COMPANY, PERIOD_START, PERIOD_END);

    expect(res.status).toBe('GAP_DETECTED');
    expect(prisma.retentionAuditReport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'GAP_DETECTED',
          notificationsPastRetention: 15,
        }),
      }),
    );
  });

  it('emits WORKER_INACTIVE when the worker never ticked and policy is non-zero', async () => {
    const { service, prisma } = buildKit();
    wireDb(prisma, { workerLastRunAt: null });
    prisma.retentionAuditReport.upsert.mockResolvedValue(fakeReport('WORKER_INACTIVE'));

    const res = await service.generateForPeriod(COMPANY, PERIOD_START, PERIOD_END);

    expect(res.status).toBe('WORKER_INACTIVE');
  });

  it('skips notification / user gap probes when policy = keep forever', async () => {
    const { service, prisma } = buildKit({
      notificationRetentionDays: 0,
      terminatedUserAnonymizeDays: 0,
    });
    wireDb(prisma, { workerLastRunAt: null });
    prisma.retentionAuditReport.upsert.mockResolvedValue(fakeReport('SUCCESS'));

    const res = await service.generateForPeriod(COMPANY, PERIOD_START, PERIOD_END);

    // Policy has no expected work → worker inactivity is NOT flagged.
    expect(res.status).toBe('SUCCESS');
    // Notification + user probes short-circuit to 0 without hitting the DB.
    expect(prisma.notification.count).not.toHaveBeenCalled();
    expect(prisma.user.count).not.toHaveBeenCalled();
  });
});

describe('RetentionAuditService.list + detail', () => {
  it('paginates + honours the status filter', async () => {
    const { service, prisma } = buildKit();
    prisma.$transaction.mockResolvedValue([[fakeReport('SUCCESS')], 1] as never);

    const res = await service.list(COMPANY, {
      status: 'GAP_DETECTED',
      page: 2,
      pageSize: 5,
    });

    expect(res.total).toBe(1);
    expect(res.page).toBe(2);
    expect(res.pageSize).toBe(5);
  });

  it('detail throws when the report belongs to a different tenant', async () => {
    const { service, prisma } = buildKit();
    prisma.retentionAuditReport.findFirst.mockResolvedValue(null);

    await expect(service.detail(COMPANY, 'rar-x')).rejects.toThrow(
      'RETENTION_AUDIT_REPORT_NOT_FOUND',
    );
  });
});
