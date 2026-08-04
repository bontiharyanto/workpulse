import { AnalyticsMetricKey } from '@prisma/client';

import {
  isAnalyticsMetricKey,
  METRIC_DESCRIPTORS,
  METRIC_KEYS,
} from './metric-keys';

describe('analytics/domain/metric-keys — Fase 33a catalogue', () => {
  it('has a descriptor for every Prisma enum value', () => {
    const enumValues = Object.values(AnalyticsMetricKey);
    for (const v of enumValues) {
      expect(METRIC_DESCRIPTORS[v]).toBeDefined();
      expect(METRIC_DESCRIPTORS[v].key).toBe(v);
    }
    // And the frozen KEYS list mirrors it exactly.
    expect([...METRIC_KEYS].sort()).toEqual(enumValues.sort());
  });

  it('every descriptor has a positive fractionDigits bounded by 6', () => {
    for (const d of Object.values(METRIC_DESCRIPTORS)) {
      expect(d.fractionDigits).toBeGreaterThanOrEqual(0);
      expect(d.fractionDigits).toBeLessThanOrEqual(6);
    }
  });

  it('every descriptor has a non-empty label + description', () => {
    for (const d of Object.values(METRIC_DESCRIPTORS)) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(4);
    }
  });

  it('type guard accepts known enum values', () => {
    expect(isAnalyticsMetricKey('ATTENDANCE_LATE_COUNT')).toBe(true);
    expect(isAnalyticsMetricKey('OVERTIME_COST_IDR')).toBe(true);
  });

  it('type guard rejects strings that resemble but do not match', () => {
    expect(isAnalyticsMetricKey('LATE_COUNT')).toBe(false);
    expect(isAnalyticsMetricKey('attendance_late_count')).toBe(false);
    expect(isAnalyticsMetricKey('')).toBe(false);
  });
});
