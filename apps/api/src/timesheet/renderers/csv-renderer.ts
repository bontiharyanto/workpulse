import type { PayrollColumn, PayrollRow } from '../domain/payroll-rows';

/**
 * RFC-4180-compliant CSV encoder for payroll rows. Deliberately pure —
 * given a fixed column list + row set it returns the exact byte-string
 * that lands in the download. We DO NOT stream to a Writable here; the
 * caller wraps the returned Buffer in a hash + response.
 *
 * Design notes:
 *
 *   - We prepend a UTF-8 BOM (`\uFEFF`) so Excel opens the file with
 *     the correct encoding on Windows without asking. This is a
 *     one-line change that saves the HR team an "encoding is broken"
 *     ticket per tenant.
 *
 *   - We use CRLF (`\r\n`) line endings — the RFC-4180 default. Excel,
 *     Numbers, Google Sheets all accept LF, but strict Unix tooling
 *     complains about mixed endings if we ever concatenate two files.
 *
 *   - Field-quoting rule: quote a value iff it contains `"`, `,`,
 *     `\r`, or `\n`. Doubled quotes escape a literal quote. Numbers
 *     never need quoting.
 *
 *   - Nulls become empty strings. External payroll systems usually
 *     read `NULL` differently per vendor; the empty cell is the
 *     lowest-common-denominator.
 */
export function renderCsv(columns: readonly PayrollColumn[], rows: readonly PayrollRow[]): Buffer {
  const lines: string[] = [];
  lines.push(columns.map((c) => encodeCell(c.header)).join(','));
  for (const row of rows) {
    lines.push(columns.map((c) => encodeCell(row[c.key])).join(','));
  }
  const body = lines.join('\r\n') + '\r\n';
  return Buffer.from('\uFEFF' + body, 'utf8');
}

function encodeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
