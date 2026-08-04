import { InvalidTimezoneError, assertValidTimezone, isValidTimezone } from './timezone';

describe('timezone', () => {
  describe('isValidTimezone', () => {
    it.each(['Asia/Jakarta', 'UTC', 'Europe/London', 'America/Los_Angeles'])('accepts %s', (tz) => {
      expect(isValidTimezone(tz)).toBe(true);
    });

    it.each([
      '',
      'Asia/Jkt', // typo
      'SGT', // legacy short code
      'not-a-timezone',
      'Asia/DoesNotExist',
    ])('rejects %s', (tz) => {
      expect(isValidTimezone(tz)).toBe(false);
    });
  });

  describe('assertValidTimezone', () => {
    it('passes silently for a valid tz', () => {
      expect(() => assertValidTimezone('Asia/Jakarta')).not.toThrow();
    });

    it('throws InvalidTimezoneError with the offending value', () => {
      let caught: unknown;
      try {
        assertValidTimezone('Asia/Jkt');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InvalidTimezoneError);
      expect((caught as InvalidTimezoneError).code).toBe('INVALID_TIMEZONE');
      expect((caught as InvalidTimezoneError).timezone).toBe('Asia/Jkt');
    });
  });
});
