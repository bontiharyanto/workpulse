import { sign, verify } from './webhook-signature';

const SECRET = 'secret-abcdefghij0123';
const NOW = 1_800_000_000_000;

describe('webhook-signature (Fase 32e)', () => {
  it('signs deterministically for the same body + secret + timestamp', () => {
    const a = sign(SECRET, '{"hello":"world"}', NOW);
    const b = sign(SECRET, '{"hello":"world"}', NOW);
    expect(a.header).toBe(b.header);
    expect(a.signatureHex).toBe(b.signatureHex);
    expect(a.timestampSec).toBe(Math.floor(NOW / 1000));
  });

  it('verifies a freshly-signed payload', () => {
    const s = sign(SECRET, 'payload', NOW);
    expect(verify(SECRET, 'payload', s.header, 300, NOW)).toEqual({
      ok: true,
      timestampSec: s.timestampSec,
    });
  });

  it('rejects a tampered body', () => {
    const s = sign(SECRET, 'payload-a', NOW);
    const result = verify(SECRET, 'payload-b', s.header, 300, NOW);
    expect(result).toEqual({ ok: false, reason: 'INVALID_SIGNATURE' });
  });

  it('rejects a wrong secret', () => {
    const s = sign(SECRET, 'payload', NOW);
    const result = verify('other', 'payload', s.header, 300, NOW);
    expect(result).toEqual({ ok: false, reason: 'INVALID_SIGNATURE' });
  });

  it('rejects a malformed header', () => {
    expect(verify(SECRET, 'p', 'not-a-header', 300, NOW)).toEqual({
      ok: false,
      reason: 'MALFORMED_HEADER',
    });
  });

  it('rejects a timestamp beyond tolerance (too old)', () => {
    const s = sign(SECRET, 'p', NOW - 10 * 60_000);
    expect(verify(SECRET, 'p', s.header, 300, NOW)).toEqual({
      ok: false,
      reason: 'TIMESTAMP_TOO_OLD',
    });
  });

  it('rejects a timestamp beyond tolerance (too new)', () => {
    const s = sign(SECRET, 'p', NOW + 10 * 60_000);
    expect(verify(SECRET, 'p', s.header, 300, NOW)).toEqual({
      ok: false,
      reason: 'TIMESTAMP_TOO_NEW',
    });
  });
});
