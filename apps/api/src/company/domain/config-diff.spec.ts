import { diffChangedKeys } from './config-diff';

describe('diffChangedKeys', () => {
  it('returns empty objects when nothing changed', () => {
    const snap = { name: 'Acme', timezone: 'Asia/Jakarta', rate: 100 };
    expect(diffChangedKeys(snap, snap)).toEqual({ before: {}, after: {} });
  });

  it('includes only the keys whose values differ', () => {
    const before = { name: 'Acme', timezone: 'Asia/Jakarta', rate: 100 };
    const after = { name: 'Acme', timezone: 'UTC', rate: 150 };
    expect(diffChangedKeys(before, after)).toEqual({
      before: { timezone: 'Asia/Jakarta', rate: 100 },
      after: { timezone: 'UTC', rate: 150 },
    });
  });

  it('distinguishes null from missing value', () => {
    const before = { rate: 100 };
    const after = { rate: null as number | null };
    expect(diffChangedKeys(before, after)).toEqual({
      before: { rate: 100 },
      after: { rate: null },
    });
  });

  it('does not treat identical zero values as a change', () => {
    const before = { grace: 0 };
    const after = { grace: 0 };
    expect(diffChangedKeys(before, after)).toEqual({ before: {}, after: {} });
  });
});
