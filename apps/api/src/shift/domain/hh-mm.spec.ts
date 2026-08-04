import {
  assertHHMM,
  crossesMidnight,
  isHHMM,
  shiftDurationMinutes,
  toMinutes,
} from './hh-mm';

describe('isHHMM', () => {
  it.each([
    ['00:00', true],
    ['09:30', true],
    ['23:59', true],
    ['24:00', false],
    ['12:60', false],
    ['9:30', false],
    ['', false],
    ['abc', false],
  ])('%s → %s', (input, expected) => {
    expect(isHHMM(input)).toBe(expected);
  });
});

describe('assertHHMM', () => {
  it('throws RangeError for malformed values', () => {
    expect(() => assertHHMM('bad')).toThrow(RangeError);
  });
});

describe('toMinutes', () => {
  it('returns minutes since 00:00', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('01:30')).toBe(90);
    expect(toMinutes('23:59')).toBe(23 * 60 + 59);
  });
});

describe('crossesMidnight', () => {
  it('is false for same-day shifts', () => {
    expect(crossesMidnight('08:00', '17:00')).toBe(false);
  });

  it('is true when end is at or before start', () => {
    expect(crossesMidnight('22:00', '06:00')).toBe(true);
    expect(crossesMidnight('12:00', '12:00')).toBe(true);
  });
});

describe('shiftDurationMinutes', () => {
  it('computes forward-day shift durations', () => {
    expect(shiftDurationMinutes('08:00', '17:00')).toBe(9 * 60);
    expect(shiftDurationMinutes('09:00', '17:30')).toBe(8 * 60 + 30);
  });

  it('computes cross-midnight durations by wrapping 24h', () => {
    expect(shiftDurationMinutes('22:00', '06:00')).toBe(8 * 60);
    expect(shiftDurationMinutes('23:30', '00:15')).toBe(45);
  });

  it('rejects zero-length shifts', () => {
    expect(() => shiftDurationMinutes('12:00', '12:00')).toThrow(RangeError);
  });
});
