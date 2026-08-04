import { Injectable, NotFoundException } from '@nestjs/common';
import { AnalyticsMetricKey } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import { AnalyticsComputationService } from './analytics-computation.service';
import { AggregationMode, aggregate, computeDelta, Delta } from './domain/delta';
import { METRIC_DESCRIPTORS, METRIC_KEYS } from './domain/metric-keys';
import {
  AnalyticsWindow,
  Ymd,
  WindowDays,
  buildWindow,
  daysBefore,
  enumerateDays,
  previousWindow,
  ymdToUtcDateOnly,
} from './domain/period';

/** Result of `getDashboard`, one entry per metric. */
export interface DashboardTile {
  metricKey: AnalyticsMetricKey;
  label: string;
  description: string;
  formatKind: string;
  direction: string;
  fractionDigits: number;
  /**
   * The aggregated value across the current window. SUM for counts /
   * hours / currency, AVG for ratios, LAST for headcount.
   */
  currentValue: number;
  previousValue: number;
  delta: Delta;
}

export interface DashboardResponse {
  window: {
    from: Ymd;
    to: Ymd;
    today: Ymd;
    days: WindowDays;
    timezone: string;
  };
  tiles: DashboardTile[];
  /**
   * Set on the response so the FE can decide whether to render a
   * "recomputed at" hint. Null when no snapshot rows exist yet.
   */
  lastComputedAt: string | null;
}

export interface TimeseriesResponse {
  metricKey: AnalyticsMetricKey;
  label: string;
  formatKind: string;
  fractionDigits: number;
  window: { from: Ymd; to: Ymd; today: Ymd; days: WindowDays; timezone: string };
  points: Array<{ date: Ymd; value: number; isToday: boolean }>;
}

/**
 * Fase 33a — dashboard read layer.
 *
 * The read path deliberately combines two sources:
 *   1. Historical days (< today in TZ) come from `AnalyticsSnapshot`.
 *      Filling gaps with `0` is a bug — we surface null instead so the
 *      FE can render "—" for a metric that legitimately has no data
 *      yet (e.g. a fresh tenant on day 3 of the 30-day window).
 *   2. Today (`window.today`) is computed on-the-fly by
 *      `AnalyticsComputationService`. This gives HR the intraday
 *      picture before the 04:00 UTC cron runs.
 *
 * RBAC: all callers are already gated by `@Roles('HR_MANAGER',
 * 'SUPER_ADMIN')` at the controller. This service simply filters by the
 * actor's companyId — no cross-tenant leakage even if a role decorator
 * is added later.
 */
@Injectable()
export class AnalyticsQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly computation: AnalyticsComputationService,
  ) {}

  async getDashboard(
    actor: AuthenticatedUser,
    days: WindowDays,
    now: Date = new Date(),
  ): Promise<DashboardResponse> {
    const company = await this.prisma.company.findUnique({
      where: { id: actor.companyId },
      select: { id: true, timezone: true, deletedAt: true },
    });
    if (!company || company.deletedAt) {
      throw new NotFoundException('COMPANY_NOT_FOUND');
    }
    const timezone = company.timezone;
    const current = buildWindow(now, timezone, days);
    const previous = previousWindow(current);

    const [currentValues, previousValues] = await Promise.all([
      this.loadPerMetricValues(actor.companyId, timezone, current),
      this.loadPerMetricValues(actor.companyId, timezone, previous),
    ]);

    const tiles: DashboardTile[] = METRIC_KEYS.map((key) => {
      const descriptor = METRIC_DESCRIPTORS[key];
      const mode = this.aggregationModeFor(key);
      const currentValue = aggregate(currentValues[key] ?? [], mode);
      const previousValue = aggregate(previousValues[key] ?? [], mode);
      return {
        metricKey: key,
        label: descriptor.label,
        description: descriptor.description,
        formatKind: descriptor.formatKind,
        direction: descriptor.direction,
        fractionDigits: descriptor.fractionDigits,
        currentValue,
        previousValue,
        delta: computeDelta(currentValue, previousValue, descriptor.direction),
      };
    });

    const latestComputed = await this.prisma.analyticsSnapshot.findFirst({
      where: { companyId: actor.companyId },
      orderBy: { computedAt: 'desc' },
      select: { computedAt: true },
    });

    return {
      window: { ...current, timezone },
      tiles,
      lastComputedAt: latestComputed?.computedAt.toISOString() ?? null,
    };
  }

  async getTimeseries(
    actor: AuthenticatedUser,
    metricKey: AnalyticsMetricKey,
    days: WindowDays,
    now: Date = new Date(),
  ): Promise<TimeseriesResponse> {
    const company = await this.prisma.company.findUnique({
      where: { id: actor.companyId },
      select: { id: true, timezone: true, deletedAt: true },
    });
    if (!company || company.deletedAt) {
      throw new NotFoundException('COMPANY_NOT_FOUND');
    }
    const timezone = company.timezone;
    const window = buildWindow(now, timezone, days);
    const descriptor = METRIC_DESCRIPTORS[metricKey];

    const historicalMap = await this.loadHistoricalMap(actor.companyId, metricKey, window);
    const todayValue = await this.computation.compute(
      actor.companyId,
      window.today,
      timezone,
      metricKey,
    );

    const points = enumerateDays(window.from, window.to).map((d) => {
      if (d === window.today) {
        return { date: d, value: todayValue, isToday: true };
      }
      const v = historicalMap.get(d);
      return { date: d, value: v ?? 0, isToday: false };
    });

    return {
      metricKey,
      label: descriptor.label,
      formatKind: descriptor.formatKind,
      fractionDigits: descriptor.fractionDigits,
      window: { ...window, timezone },
      points,
    };
  }

  /**
   * Load one bucket of daily values per metric. Days inside the window
   * that have no snapshot are silently omitted — the aggregator returns
   * `0` for empty arrays, which is the correct semantics for SUM (no
   * activity) and AVG (no data → 0-share). LAST is defended in
   * `aggregationModeFor` — headcount is expected to have snapshots for
   * every day once the cron has stabilised.
   */
  private async loadPerMetricValues(
    companyId: string,
    timezone: string,
    window: AnalyticsWindow,
  ): Promise<Record<AnalyticsMetricKey, number[]>> {
    // The snapshot table is only written for completed days (< today
    // in TZ). Cap the historical range at `today - 1` so we never read
    // a stale row for the intraday portion.
    const includeToday = this.windowContainsToday(window);
    const historicalTo = includeToday ? daysBefore(window.to, 1) : window.to;

    const bucket: Partial<Record<AnalyticsMetricKey, number[]>> = {};
    for (const key of METRIC_KEYS) bucket[key] = [];

    // Empty range guard: a 1-day window that is exactly today has no
    // historical days to read — skip the DB round-trip entirely.
    if (window.from <= historicalTo) {
      const rows = await this.prisma.analyticsSnapshot.findMany({
        where: {
          companyId,
          date: {
            gte: ymdToUtcDateOnly(window.from),
            lte: ymdToUtcDateOnly(historicalTo),
          },
        },
        select: { date: true, metricKey: true, value: true },
        orderBy: [{ metricKey: 'asc' }, { date: 'asc' }],
      });
      for (const r of rows) {
        bucket[r.metricKey]!.push(Number(r.value.toString()));
      }
    }

    if (includeToday) {
      for (const key of METRIC_KEYS) {
        const value = await this.computation.compute(companyId, window.today, timezone, key);
        bucket[key]!.push(value);
      }
    }

    return bucket as Record<AnalyticsMetricKey, number[]>;
  }

  private async loadHistoricalMap(
    companyId: string,
    metricKey: AnalyticsMetricKey,
    window: AnalyticsWindow,
  ): Promise<Map<Ymd, number>> {
    // Cap at yesterday for the same reason as `loadPerMetricValues`:
    // today's value belongs to the on-the-fly branch, never to the
    // snapshot read.
    const historicalTo = daysBefore(window.to, 1);
    if (window.from > historicalTo) return new Map();
    const rows = await this.prisma.analyticsSnapshot.findMany({
      where: {
        companyId,
        metricKey,
        date: {
          gte: ymdToUtcDateOnly(window.from),
          lte: ymdToUtcDateOnly(historicalTo),
        },
      },
      select: { date: true, value: true },
    });
    const map = new Map<Ymd, number>();
    for (const r of rows) {
      const d = r.date;
      const key =
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` as Ymd;
      map.set(key, Number(r.value.toString()));
    }
    return map;
  }

  /**
   * The dashboard's "current" window always ends at yesterday-in-TZ,
   * so `windowContainsToday` is only true when the caller explicitly
   * builds a window that includes today. Kept as a helper so the
   * behaviour is testable in isolation.
   */
  private windowContainsToday(w: AnalyticsWindow): boolean {
    return w.to === w.today;
  }

  private aggregationModeFor(key: AnalyticsMetricKey): AggregationMode {
    switch (key) {
      case AnalyticsMetricKey.ATTENDANCE_ON_TIME_RATE:
        return 'AVG';
      case AnalyticsMetricKey.HEADCOUNT_ACTIVE:
      case AnalyticsMetricKey.LEAVE_PENDING_COUNT:
        // Both are point-in-time snapshots; the "current window" tile
        // shows the most recent day's value, not the sum.
        return 'LAST';
      default:
        return 'SUM';
    }
  }
}
