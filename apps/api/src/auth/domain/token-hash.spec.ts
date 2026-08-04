import {
  generateRefreshSecret,
  hashRefreshSecret,
  secureCompareHex,
} from './token-hash';

describe('token-hash', () => {
  it('generates url-safe random secrets of expected length', () => {
    const a = generateRefreshSecret();
    const b = generateRefreshSecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    // 48 bytes → 64 base64url chars
    expect(a.length).toBe(64);
  });

  it('hashRefreshSecret is deterministic and hex-encoded (64 chars for SHA-256)', () => {
    const secret = 'test-secret';
    const h1 = hashRefreshSecret(secret);
    const h2 = hashRefreshSecret(secret);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('secureCompareHex returns true for equal hashes', () => {
    const h = hashRefreshSecret('same');
    expect(secureCompareHex(h, h)).toBe(true);
  });

  it('secureCompareHex returns false for different hashes and mismatched lengths', () => {
    const a = hashRefreshSecret('a');
    const b = hashRefreshSecret('b');
    expect(secureCompareHex(a, b)).toBe(false);
    expect(secureCompareHex(a, a.slice(0, -2))).toBe(false);
  });
});
