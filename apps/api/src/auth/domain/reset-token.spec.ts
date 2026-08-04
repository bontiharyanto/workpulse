import {
  generateResetToken,
  hashResetToken,
  looksLikeResetToken,
  RESET_TOKEN_TTL_MINUTES,
} from './reset-token';

describe('generateResetToken', () => {
  it('produces different tokens on repeated calls (never predictable)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateResetToken().rawToken);
    expect(seen.size).toBe(1000);
  });

  it('emits a raw token that is URL-safe base64url', () => {
    const { rawToken } = generateResetToken();
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
    // 48 bytes → base64url without padding = 64 chars
    expect(rawToken).toHaveLength(64);
  });

  it('emits a matching SHA-256 hex hash', () => {
    const { rawToken, tokenHash } = generateResetToken();
    expect(tokenHash).toHaveLength(64);
    expect(tokenHash).toMatch(/^[0-9a-f]+$/);
    expect(tokenHash).toBe(hashResetToken(rawToken));
  });
});

describe('hashResetToken', () => {
  it('is deterministic (same input → same hash)', () => {
    expect(hashResetToken('foo')).toBe(hashResetToken('foo'));
  });

  it('produces distinct hashes for distinct inputs', () => {
    expect(hashResetToken('foo')).not.toBe(hashResetToken('bar'));
  });
});

describe('looksLikeResetToken', () => {
  it('accepts a freshly-generated token', () => {
    expect(looksLikeResetToken(generateResetToken().rawToken)).toBe(true);
  });

  it('rejects non-strings', () => {
    expect(looksLikeResetToken(undefined)).toBe(false);
    expect(looksLikeResetToken(null)).toBe(false);
    expect(looksLikeResetToken(123)).toBe(false);
    expect(looksLikeResetToken({})).toBe(false);
  });

  it('rejects strings that are too short or too long', () => {
    expect(looksLikeResetToken('abc')).toBe(false);
    expect(looksLikeResetToken('x'.repeat(200))).toBe(false);
  });

  it('rejects strings with disallowed characters', () => {
    // Regular base64 (with `+/=`) is NOT accepted — we only issue base64url.
    expect(looksLikeResetToken('abcdefghijklmnopqrstuvwxyz+/=aaaaaaaaaaaaaaa')).toBe(false);
    expect(looksLikeResetToken('spaces here in the middle of the string plz')).toBe(false);
  });
});

describe('RESET_TOKEN_TTL_MINUTES', () => {
  it('is short — short-lived reset tokens are safer', () => {
    expect(RESET_TOKEN_TTL_MINUTES).toBeGreaterThan(0);
    expect(RESET_TOKEN_TTL_MINUTES).toBeLessThanOrEqual(60);
  });
});
