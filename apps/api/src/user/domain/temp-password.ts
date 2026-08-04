import { randomInt } from 'node:crypto';

/**
 * Unambiguous alphabet: excludes visually confusable chars (0/O, 1/l/I) so
 * users can transcribe from screen/email without errors.
 */
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#%&*';

/**
 * Generate a cryptographically secure temporary password.
 *
 * Uses `crypto.randomInt` (rejection sampling — no modulo bias) over a curated
 * 63-char alphabet. Guarantees the returned string contains at least one letter,
 * one digit, and one symbol so it satisfies typical password policies.
 *
 * @throws RangeError when `length < 8` — we refuse to generate weak passwords.
 */
export function generateTempPassword(length = 14): string {
  if (length < 8) {
    throw new RangeError('temp password must be at least 8 characters');
  }

  const buckets = {
    letters: 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ',
    digits: '23456789',
    symbols: '!@#%&*',
  } as const;

  const required = [buckets.letters, buckets.digits, buckets.symbols];

  const chars: string[] = required.map((bucket) => pick(bucket));

  for (let i = chars.length; i < length; i += 1) {
    chars.push(pick(ALPHABET));
  }

  // Fisher–Yates with a crypto-strong RNG so required-class chars are not always at the front.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    const swap = chars[i];
    const other = chars[j];
    if (swap === undefined || other === undefined) continue;
    chars[i] = other;
    chars[j] = swap;
  }

  return chars.join('');
}

function pick(source: string): string {
  // randomInt is uniform over [0, source.length); charAt returns '' on out-of-range,
  // but our range is bounded by the string length so it always returns a char.
  return source.charAt(randomInt(0, source.length));
}
