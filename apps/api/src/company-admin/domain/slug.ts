/**
 * Company slug derivation + validation. Kept pure so unit tests can exercise
 * the exhaustive edge-case list without spinning up Nest.
 *
 * Rules:
 *   - lowercase ASCII letters, digits, hyphens only
 *   - collapse runs of non-alnum to a single hyphen
 *   - strip leading/trailing hyphens
 *   - trim to 40 chars
 *   - fall back to `company` when the input collapses to empty
 */
const MAX_SLUG_LENGTH = 40;

export function derivateSlug(input: string): string {
  const lowered = input.toLowerCase();
  const cleaned = lowered
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    // Second trim after slice — a slice mid-hyphen would leave a trailing '-'.
    .replace(/-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'company';
}

export const SLUG_REGEX = /^[a-z0-9-]+$/;

export function isValidSlug(slug: string): boolean {
  return typeof slug === 'string' && slug.length > 0 && SLUG_REGEX.test(slug);
}

/**
 * Append `-2`, `-3`, … to the base slug until `isAvailable` says yes. Bounded
 * to avoid unbounded loops when the DB is unavailable — the caller is
 * expected to surface a 500 in that case.
 */
export async function uniqueSlug(
  base: string,
  isAvailable: (candidate: string) => Promise<boolean>,
  maxAttempts = 100,
): Promise<string> {
  let candidate = base;
  for (let i = 1; i <= maxAttempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await isAvailable(candidate)) return candidate;
    const suffix = `-${i + 1}`;
    candidate = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
  }
  throw new Error('SLUG_UNIQUENESS_EXHAUSTED');
}
