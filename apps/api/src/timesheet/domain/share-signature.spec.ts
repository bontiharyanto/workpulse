import { sign, verify } from './share-signature';

const SECRET = 'a'.repeat(32);
const FIXED_NOW = 1_800_000_000_000;

describe('share-signature (Fase 32d)', () => {
  const payload = { shareId: 'share-1', expiresAtMs: FIXED_NOW + 60_000 };

  it('signs deterministically for the same payload + secret', () => {
    expect(sign(SECRET, payload)).toBe(sign(SECRET, payload));
  });

  it('verifies a freshly-signed payload', () => {
    const sig = sign(SECRET, payload);
    const result = verify(SECRET, payload, sig, FIXED_NOW);
    expect(result).toEqual({ ok: true });
  });

  it('rejects a tampered signature with INVALID_SIGNATURE', () => {
    const sig = sign(SECRET, payload);
    // Flip the last char of the base64url payload; length matches so
    // we exercise the timingSafeEqual path, not the length short-circuit.
    const tampered = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    const result = verify(SECRET, payload, tampered, FIXED_NOW);
    expect(result).toEqual({ ok: false, reason: 'INVALID_SIGNATURE' });
  });

  it('rejects a wrong-secret signature', () => {
    const sig = sign(SECRET, payload);
    const result = verify('b'.repeat(32), payload, sig, FIXED_NOW);
    expect(result).toEqual({ ok: false, reason: 'INVALID_SIGNATURE' });
  });

  it('rejects a malformed signature length', () => {
    const result = verify(SECRET, payload, 'not-a-hmac', FIXED_NOW);
    expect(result).toEqual({ ok: false, reason: 'MALFORMED_SIGNATURE' });
  });

  it('rejects an expired payload — but only after signature verify', () => {
    const expired = { shareId: 'share-1', expiresAtMs: FIXED_NOW - 1 };
    const sig = sign(SECRET, expired);
    const result = verify(SECRET, expired, sig, FIXED_NOW);
    expect(result).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('rejects a payload whose shareId was substituted', () => {
    const sig = sign(SECRET, payload);
    const substituted = { shareId: 'share-2', expiresAtMs: payload.expiresAtMs };
    const result = verify(SECRET, substituted, sig, FIXED_NOW);
    expect(result).toEqual({ ok: false, reason: 'INVALID_SIGNATURE' });
  });

  it('rejects a payload whose expiresAt was substituted', () => {
    const sig = sign(SECRET, payload);
    const substituted = {
      shareId: payload.shareId,
      expiresAtMs: payload.expiresAtMs + 3_600_000,
    };
    const result = verify(SECRET, substituted, sig, FIXED_NOW);
    expect(result).toEqual({ ok: false, reason: 'INVALID_SIGNATURE' });
  });
});
