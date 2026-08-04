import { Prisma } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { PrismaService } from '../prisma/prisma.service';

import { AnalyticsComputationService } from './analytics-computation.service';
import { AnalyticsSnapshotService } from './analytics-snapshot.service';
import { METRIC_KEYS } from './domain/metric-keys';
import { asYmd } from './domain/period';

interface Kit {
  service: AnalyticsSnapshotService;
  prisma: DeepMockProxy<PrismaService>;
  computation: DeepMockProxy<AnalyticsComputationService>;
}

function buildKit(): Kit {
  const prisma = mockDeep<PrismaService>();
  const computation = mockDeep<AnalyticsComputationService>();
  mockReset(prisma);
  mockReset(computation);

  const service = new AnalyticsSnapshotService(
    prisma as unknown as PrismaService,
    computation as unknown as AnalyticsComputationService,
  );
  return { service, prisma, computation };
}

describe('AnalyticsSnapshotService — Fase 33a', () => {
  it('snapshotOneTenant upserts one row per metric with the computed value', async () => {
    const { service, prisma, computation } = buildKit();
    computation.compute.mockImplementation(async (_c, _d, _tz, key) => {
      const idx = METRIC_KEYS.indexOf(key);
      return idx + 1;
    });

    await service.snapshotOneTenant('company-1', asYmd('2026-08-02'), 'Asia/Jakarta');

    expect(computation.compute).toHaveBeenCalledTimes(METRIC_KEYS.length);
    expect(prisma.analyticsSnapshot.upsert).toHaveBeenCalledTimes(METRIC_KEYS.length);

    const firstCall = prisma.analyticsSnapshot.upsert.mock.calls[0]![0];
    expect(firstCall.where).toEqual({
      companyId_date_metricKey: {
        companyId: 'company-1',
        date: new Date(Date.UTC(2026, 7, 2)),
        metricKey: METRIC_KEYS[0],
      },
    });
    expect(Number((firstCall.create as { value: Prisma.Decimal }).value.toString())).toBe(1);
  });

  it('backfill iterates every day in the range inclusively', async () => {
    const { service, computation } = buildKit();
    computation.compute.mockResolvedValue(1);

    const result = await service.backfill(
      'c-1',
      asYmd('2026-08-01'),
      asYmd('2026-08-03'),
      'Asia/Jakarta',
    );
    expect(result.daysProcessed).toBe(3);
    // 3 days × N metrics
    expect(computation.compute).toHaveBeenCalledTimes(3 * METRIC_KEYS.length);
  });

  it('snapshotAllTenants continues past a failing tenant and reports the split', async () => {
    const { service, prisma, computation } = buildKit();
    prisma.company.findMany.mockResolvedValue([
      { id: 'c-good', timezone: 'Asia/Jakarta' } as never,
      { id: 'c-bad', timezone: 'Asia/Jakarta' } as never,
    ]);

    computation.compute.mockImplementation(async (companyId) => {
      if (companyId === 'c-bad') throw new Error('boom');
      return 42;
    });

    const now = new Date('2026-08-03T05:00:00Z');
    const summary = await service.snapshotAllTenants(now);
    expect(summary.tenantsProcessed).toBe(1);
    expect(summary.tenantsFailed).toBe(1);
  });

  it('re-running snapshotOneTenant on the same day is idempotent (upsert)', async () => {
    const { service, prisma, computation } = buildKit();
    computation.compute.mockResolvedValue(0.98);

    await service.snapshotOneTenant('c-1', asYmd('2026-08-02'), 'Asia/Jakarta');
    await service.snapshotOneTenant('c-1', asYmd('2026-08-02'), 'Asia/Jakarta');

    // Every call is an `upsert` — DB semantics guarantee no duplicates.
    // We just confirm the second run issues the same upserts.
    expect(prisma.analyticsSnapshot.upsert).toHaveBeenCalledTimes(METRIC_KEYS.length * 2);
  });
});
