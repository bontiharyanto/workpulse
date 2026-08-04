import { derivateSlug, isValidSlug, uniqueSlug } from './slug';

describe('derivateSlug', () => {
  it.each([
    ['Acme Corp', 'acme-corp'],
    ['Foo & Bar', 'foo-bar'],
    ['   Trim Me   ', 'trim-me'],
    ['A_B/C.D', 'a-b-c-d'],
    ['PT Sinar Mas', 'pt-sinar-mas'],
    ['🚀 Rocket', 'rocket'],
    ['---edges---', 'edges'],
  ])('derives %s → %s', (input, expected) => {
    expect(derivateSlug(input)).toBe(expected);
  });

  it('falls back to "company" for input that collapses to empty', () => {
    expect(derivateSlug('!!!')).toBe('company');
    expect(derivateSlug('   ')).toBe('company');
  });

  it('truncates to 40 chars without leaving a trailing hyphen', () => {
    const long = 'A'.repeat(60);
    const out = derivateSlug(long);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('-')).toBe(false);
  });
});

describe('isValidSlug', () => {
  it('accepts valid slugs', () => {
    expect(isValidSlug('acme')).toBe(true);
    expect(isValidSlug('acme-corp-1')).toBe(true);
    expect(isValidSlug('123')).toBe(true);
  });

  it('rejects invalid slugs', () => {
    expect(isValidSlug('Acme')).toBe(false);
    expect(isValidSlug('acme_corp')).toBe(false);
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('acme space')).toBe(false);
  });
});

describe('uniqueSlug', () => {
  it('returns the base slug when it is available', async () => {
    const check = jest.fn().mockResolvedValue(true);
    await expect(uniqueSlug('acme', check)).resolves.toBe('acme');
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('appends -2, -3 … until a free candidate is found', async () => {
    const taken = new Set(['acme', 'acme-2', 'acme-3']);
    const check = jest.fn(async (candidate: string) => !taken.has(candidate));
    await expect(uniqueSlug('acme', check)).resolves.toBe('acme-4');
  });

  it('throws when exhausted', async () => {
    const check = jest.fn().mockResolvedValue(false);
    await expect(uniqueSlug('acme', check, 3)).rejects.toThrow('SLUG_UNIQUENESS_EXHAUSTED');
  });

  it('keeps the total length ≤ 40 when appending suffixes', async () => {
    const base = 'a'.repeat(40);
    let call = 0;
    const check = jest.fn(async () => {
      call += 1;
      return call > 1; // first candidate taken, second free
    });
    const result = await uniqueSlug(base, check);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result.endsWith('-2')).toBe(true);
  });
});
