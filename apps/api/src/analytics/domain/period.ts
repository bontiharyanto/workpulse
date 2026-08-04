/**
 * Fase 33a — pure date-window helpers.
 *
 * All date arithmetic in analytics happens on **tenant-local calendar
 * days**, not UTC timestamps. That means we never build ranges by
 * subtracting milliseconds from Date.now() — DST + timezone offsets
 * would silently drift the window and produce ghost rows on the day
 * boundaries.
 *
 * Everything downstream (snapshot writer, query service, controller) MUST
 * go through these helpers so the semantics stay identical between the
 * write path (build "yesterday in TZ" for the cron) and the read path
 * (build "last 30 days in TZ" for the dashboard).
 */

/** ISO calendar-day string (YYYY-MM-DD) with day-precision only. */
export type Ymd = string & { readonly __brand: 'Ymd' };

/** Number of calendar days in a supported look-back window. */
export const SUPPORTED_WINDOWS = [7, 30, 90, 365] as const;
export type WindowDays = (typeof SUPPORTED_WINDOWS)[number];

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(v: string): v is Ymd {
  return YMD_RE.test(v);
}

export function asYmd(v: string): Ymd {
  if (!isYmd(v)) {
    throw new Error(`Not a YYYY-MM-DD date: ${JSON.stringify(v)}`);
  }
  return v as Ymd;
}

/**
 * Project `now` (a UTC timestamp) onto the tenant-local calendar. Uses
 * `Intl.DateTimeFormat` with `en-CA` (the only locale that formats as
 * ISO by default). No dependency on external date libraries so the
 * function is unit-testable in isolation.
 */
export function todayInTz(now: Date, timezone: string): Ymd {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(now) as Ymd;
}

/**
 * `daysBefore("2026-08-03", 1) === "2026-08-02"`.
 * Uses Date.UTC math with day granularity so DST is irrelevant.
 */
export function daysBefore(ymd: Ymd, n: number): Ymd {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  const utc = Date.UTC(y, m - 1, d) - n * 86_400_000;
  const dt = new Date(utc);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}` as Ymd;
}

export function daysBetween(earlier: Ymd, later: Ymd): number {
  const a = Date.UTC(
    Number(earlier.slice(0, 4)),
    Number(earlier.slice(5, 7)) - 1,
    Number(earlier.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(later.slice(0, 4)),
    Number(later.slice(5, 7)) - 1,
    Number(later.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}

/**
 * The inclusive-inclusive window `[from, to]` that the dashboard's KPI
 * card reads. The **current** window has `to === today` so intraday
 * data flows in via the on-the-fly branch of the query service; the
 * **previous** window (built via `previousWindow`) has `to < today` and
 * reads exclusively from the snapshot table.
 */
export interface AnalyticsWindow {
  /** First day in the window (inclusive). */
  from: Ymd;
  /** Last day in the window (inclusive). */
  to: Ymd;
  /**
   * Today in the tenant TZ. Only relevant when `to === today` — the
   * query service uses this to switch on the "recompute live" branch
   * for that single date rather than reading a (missing) snapshot row.
   */
  today: Ymd;
  /** Length of the window in days (matches `SUPPORTED_WINDOWS`). */
  days: WindowDays;
}

export function buildWindow(
  now: Date,
  timezone: string,
  days: WindowDays,
): AnalyticsWindow {
  const today = todayInTz(now, timezone);
  const from = daysBefore(today, days - 1);
  return { from, to: today, today, days };
}

/**
 * The **previous** window immediately abutting `w` — used to compute
 * period-over-period deltas without overlap. For `w = last 30 days`
 * this returns the 30 days ending the day before `w.from`.
 */
export function previousWindow(w: AnalyticsWindow): AnalyticsWindow {
  const prevTo = daysBefore(w.from, 1);
  const prevFrom = daysBefore(prevTo, w.days - 1);
  return { from: prevFrom, to: prevTo, today: w.today, days: w.days };
}

/**
 * Enumerate every calendar day inside `[from, to]` inclusive. Used to
 * densify the timeseries response so the FE can render a chart without
 * having to fill gaps client-side.
 */
export function enumerateDays(from: Ymd, to: Ymd): Ymd[] {
  const n = daysBetween(from, to);
  if (n < 0) return [];
  const out: Ymd[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    out[i] = daysBefore(to, n - i);
  }
  return out;
}

/**
 * Convert a tenant-local `Ymd` to the pair of UTC timestamps bounding
 * that day. Callers use these to build `WHERE workDate >= start AND
 * workDate < end` clauses when scanning `DateTime @db.Date` columns,
 * which Postgres stores at midnight UTC.
 *
 * NOTE: For `@db.Date` columns we compare against the UTC midnight of
 * the given Y-M-D — Postgres represents a `DATE` value as UTC midnight
 * when Prisma reads it back into `Date`. For `DateTime` columns (e.g.
 * `clockInAt`, `createdAt`) callers should combine the tenant TZ with
 * this Y-M-D to build the exact UTC boundary; that helper is
 * intentionally not here to keep this file dependency-free.
 */
export function ymdToUtcDateOnly(ymd: Ymd): Date {
  return new Date(
    Date.UTC(
      Number(ymd.slice(0, 4)),
      Number(ymd.slice(5, 7)) - 1,
      Number(ymd.slice(8, 10)),
    ),
  );
}

/**
 * Build the UTC instant that starts the tenant-local day `ymd`. Handy
 * for `WHERE clockInAt >= startOfDay(ymd, tz)` scans where the column
 * is a timestamp, not a date.
 *
 * Implementation trick: because tenant offsets aren't fixed (DST!),
 * we cannot just subtract 7h for Asia/Jakarta and hope for the best.
 * We snap by walking through `Intl.DateTimeFormat` for the target TZ
 * on progressively earlier UTC instants until the format lands on the
 * previous day — a tiny amount of work executed on the cron path only.
 */
export function tzDayStartUtc(ymd: Ymd, timezone: string): Date {
  // Start with an approximation and correct via `todayInTz`. In practice
  // this converges in ≤ 2 iterations for every timezone Node supports.
  const approx = ymdToUtcDateOnly(ymd);
  for (let hourShift = -14; hourShift <= 14; hourShift++) {
    const cand = new Date(approx.getTime() - hourShift * 3_600_000);
    if (todayInTz(cand, timezone) === ymd) {
      // We now have SOME instant on the local day. Walk back an hour at a
      // time until we cross out of it → the last "in-day" instant is
      // `start + 1ms` short of the exit; scan forward instead.
      let lo = cand.getTime() - 24 * 3_600_000;
      let hi = cand.getTime();
      while (hi - lo > 60_000) {
        const mid = Math.floor((lo + hi) / 2);
        if (todayInTz(new Date(mid), timezone) === ymd) hi = mid;
        else lo = mid;
      }
      // At this point [lo, hi] straddles the boundary within 1 minute.
      // Return the smallest UTC ms whose local day is `ymd`.
      return new Date(hi);
    }
  }
  throw new Error(
    `tzDayStartUtc: could not resolve ${ymd} in timezone ${timezone}`,
  );
}

/**
 * Build the UTC instant that ends the tenant-local day `ymd` — i.e. the
 * start of the next tenant-local day. Callers use it as the strict
 * upper bound in `WHERE ts < endOfDay(...)`.
 */
export function tzDayEndUtc(ymd: Ymd, timezone: string): Date {
  return tzDayStartUtc(daysBefore(ymd, -1), timezone);
}
