/**
 * Shared formatters used across feature modules. Locked to Indonesian
 * locale (`id-ID`) + IDR currency. Instantiated once at module scope
 * so we don't pay the `Intl.NumberFormat` constructor cost on every
 * render (measurable in large tables).
 */

const IDR_FORMATTER = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

/** Format a numeric amount as Indonesian Rupiah (e.g. `Rp 1.250.000`). */
export function formatIDR(amount: number): string {
  return IDR_FORMATTER.format(amount);
}

const NUMBER_FORMATTER = new Intl.NumberFormat('id-ID');

/** Format a number with Indonesian thousand separators (`1.250.000`). */
export function formatNumber(n: number): string {
  return NUMBER_FORMATTER.format(n);
}

/**
 * Format a `YYYY-MM-DD` calendar date as short human-readable Indonesian
 * (`Kam, 04 Agt 2026`). Uses UTC parsing to avoid TZ drift — the string
 * always represents a company local calendar day.
 */
export function formatCalendarDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Format an ISO instant as `dd MMM yyyy · HH:mm` in local TZ. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${date} · ${time}`;
}
