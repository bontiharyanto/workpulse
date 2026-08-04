import {
  CUSTOM_REPORT_DIMENSIONS,
  CUSTOM_REPORT_METRICS,
  CUSTOM_REPORT_WINDOWS,
  InvalidReportDefinitionError,
  metricDescriptor,
  validateDefinition,
} from './custom-report-definition';

describe('validateDefinition', () => {
  const good = {
    dimension: 'DAY',
    metric: 'ATTENDANCE_ON_TIME_RATE',
    filter: { windowDays: 30 },
  };

  it('accepts a well-formed definition and normalises the shape', () => {
    const out = validateDefinition(good);
    expect(out).toEqual(good);
    // Ensure it is a copy and not the same reference (no mutation risk).
    expect(out).not.toBe(good);
  });

  it('rejects non-object payloads', () => {
    expect(() => validateDefinition(null)).toThrow(InvalidReportDefinitionError);
    expect(() => validateDefinition('nope')).toThrow(InvalidReportDefinitionError);
    expect(() => validateDefinition(42)).toThrow(InvalidReportDefinitionError);
  });

  it('rejects unknown dimensions', () => {
    expect(() =>
      validateDefinition({ ...good, dimension: 'HOUR' }),
    ).toThrow(/dimension/);
  });

  it('rejects unknown metrics', () => {
    expect(() =>
      validateDefinition({ ...good, metric: 'RANDOM_METRIC' }),
    ).toThrow(/metric/);
  });

  it('rejects unknown window values', () => {
    expect(() =>
      validateDefinition({ ...good, filter: { windowDays: 45 } }),
    ).toThrow(/windowDays/);
  });

  it('rejects non-string departmentId', () => {
    expect(() =>
      validateDefinition({
        ...good,
        filter: { windowDays: 30, departmentId: 42 },
      }),
    ).toThrow(/departmentId/);
  });

  it('accepts every enumerated combination round-trip', () => {
    for (const d of CUSTOM_REPORT_DIMENSIONS) {
      for (const m of CUSTOM_REPORT_METRICS) {
        for (const w of CUSTOM_REPORT_WINDOWS) {
          const def = { dimension: d, metric: m, filter: { windowDays: w } };
          expect(validateDefinition(def)).toEqual(def);
        }
      }
    }
  });
});

describe('metricDescriptor', () => {
  it('returns the descriptor for every known metric', () => {
    for (const m of CUSTOM_REPORT_METRICS) {
      const d = metricDescriptor(m);
      expect(d.metric).toBe(m);
      expect(d.label.length).toBeGreaterThan(0);
    }
  });
});
