/**
 * Fase 33b — declarative custom-report definition.
 *
 * A `SavedReport.definition` blob is a **frozen recipe**: dimension +
 * metric + filter. There is NO free-form SQL. Every combination is
 * enumerable and validated against this module before the query
 * builder runs it — this is the single security choke-point for the
 * feature.
 *
 * Enum-driven design keeps the FE picker (dimension dropdown, metric
 * list) and the BE executor in lockstep.
 */

export const CUSTOM_REPORT_DIMENSIONS = ['DAY', 'DEPARTMENT', 'USER'] as const;
export type CustomReportDimension = (typeof CUSTOM_REPORT_DIMENSIONS)[number];

export const CUSTOM_REPORT_METRICS = [
  'ATTENDANCE_COUNT',
  'ATTENDANCE_LATE_COUNT',
  'ATTENDANCE_ON_TIME_RATE',
  'LEAVE_DAYS_APPROVED',
  'OVERTIME_HOURS',
] as const;
export type CustomReportMetric = (typeof CUSTOM_REPORT_METRICS)[number];

export const CUSTOM_REPORT_WINDOWS = [7, 30, 90, 365] as const;
export type CustomReportWindow = (typeof CUSTOM_REPORT_WINDOWS)[number];

export interface CustomReportFilter {
  windowDays: CustomReportWindow;
  /** Optional narrowing to a specific department. */
  departmentId?: string;
}

export interface CustomReportDefinition {
  dimension: CustomReportDimension;
  metric: CustomReportMetric;
  filter: CustomReportFilter;
}

export class InvalidReportDefinitionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'InvalidReportDefinitionError';
  }
}

/**
 * Full validator: returns a **typed, normalised** definition. Throws
 * `InvalidReportDefinitionError` on any structural or catalogue
 * violation. Never mutates the input.
 */
export function validateDefinition(raw: unknown): CustomReportDefinition {
  if (raw === null || typeof raw !== 'object') {
    throw new InvalidReportDefinitionError('definition must be an object');
  }
  const obj = raw as Record<string, unknown>;

  const dimension = obj.dimension;
  if (
    typeof dimension !== 'string' ||
    !(CUSTOM_REPORT_DIMENSIONS as readonly string[]).includes(dimension)
  ) {
    throw new InvalidReportDefinitionError(
      `dimension must be one of ${CUSTOM_REPORT_DIMENSIONS.join(', ')}`,
    );
  }

  const metric = obj.metric;
  if (
    typeof metric !== 'string' ||
    !(CUSTOM_REPORT_METRICS as readonly string[]).includes(metric)
  ) {
    throw new InvalidReportDefinitionError(
      `metric must be one of ${CUSTOM_REPORT_METRICS.join(', ')}`,
    );
  }

  const filter = obj.filter;
  if (filter === null || typeof filter !== 'object') {
    throw new InvalidReportDefinitionError('filter must be an object');
  }
  const filterObj = filter as Record<string, unknown>;
  const windowDays = filterObj.windowDays;
  if (
    typeof windowDays !== 'number' ||
    !(CUSTOM_REPORT_WINDOWS as readonly number[]).includes(windowDays)
  ) {
    throw new InvalidReportDefinitionError(
      `filter.windowDays must be one of ${CUSTOM_REPORT_WINDOWS.join(', ')}`,
    );
  }
  const departmentId = filterObj.departmentId;
  if (departmentId !== undefined && typeof departmentId !== 'string') {
    throw new InvalidReportDefinitionError('filter.departmentId must be a string when provided');
  }

  return {
    dimension: dimension as CustomReportDimension,
    metric: metric as CustomReportMetric,
    filter: {
      windowDays: windowDays as CustomReportWindow,
      ...(departmentId !== undefined && { departmentId }),
    },
  };
}

// ------- Metric metadata (label / unit / formatter) -------

export interface MetricDescriptor {
  metric: CustomReportMetric;
  label: string;
  /** For UI + XLSX column headers. */
  unit: 'count' | 'rate' | 'days' | 'hours';
  fractionDigits: number;
}

export const CUSTOM_METRIC_DESCRIPTORS: ReadonlyArray<MetricDescriptor> = [
  {
    metric: 'ATTENDANCE_COUNT',
    label: 'Attendance count',
    unit: 'count',
    fractionDigits: 0,
  },
  {
    metric: 'ATTENDANCE_LATE_COUNT',
    label: 'Late attendance count',
    unit: 'count',
    fractionDigits: 0,
  },
  {
    metric: 'ATTENDANCE_ON_TIME_RATE',
    label: 'On-time attendance rate',
    unit: 'rate',
    fractionDigits: 3,
  },
  {
    metric: 'LEAVE_DAYS_APPROVED',
    label: 'Leave days approved',
    unit: 'days',
    fractionDigits: 1,
  },
  {
    metric: 'OVERTIME_HOURS',
    label: 'Overtime hours',
    unit: 'hours',
    fractionDigits: 2,
  },
];

export function metricDescriptor(m: CustomReportMetric): MetricDescriptor {
  return (
    CUSTOM_METRIC_DESCRIPTORS.find((d) => d.metric === m) ?? {
      metric: m,
      label: m,
      unit: 'count',
      fractionDigits: 0,
    }
  );
}
