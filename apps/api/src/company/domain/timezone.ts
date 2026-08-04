/**
 * Timezone validation using the runtime's IANA database. We reject any name
 * that `Intl.DateTimeFormat` cannot resolve — this catches typos ("Asia/Jkt"),
 * legacy short codes ("SGT"), and freeform text.
 *
 * Kept pure (no DI, no side effects) so the service and DTO layer can both
 * reuse it without spinning up a Nest module context in tests.
 */

export class InvalidTimezoneError extends Error {
  readonly code = 'INVALID_TIMEZONE';
  constructor(readonly timezone: string) {
    super(`Timezone tidak dikenal: "${timezone}"`);
  }
}

export function assertValidTimezone(tz: string): void {
  if (!isValidTimezone(tz)) throw new InvalidTimezoneError(tz);
}

export function isValidTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
