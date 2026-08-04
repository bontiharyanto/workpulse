import { hasOverlappingAssignment, rangesOverlap } from './shift-assignment-range';

describe('rangesOverlap', () => {
  it('is false for adjacent (touching) ranges', () => {
    // A = [Jan 1, Feb 1)  B = [Feb 1, Mar 1)  → boundary touches, no overlap
    expect(
      rangesOverlap(
        { effectiveFrom: '2026-01-01', effectiveTo: '2026-02-01' },
        { effectiveFrom: '2026-02-01', effectiveTo: '2026-03-01' },
      ),
    ).toBe(false);
  });

  it('is true for interior overlap', () => {
    expect(
      rangesOverlap(
        { effectiveFrom: '2026-01-01', effectiveTo: '2026-02-15' },
        { effectiveFrom: '2026-02-01', effectiveTo: '2026-03-01' },
      ),
    ).toBe(true);
  });

  it('is false when A ends before B starts', () => {
    expect(
      rangesOverlap(
        { effectiveFrom: '2026-01-01', effectiveTo: '2026-01-15' },
        { effectiveFrom: '2026-02-01', effectiveTo: null },
      ),
    ).toBe(false);
  });

  it('treats null effectiveTo as +∞', () => {
    // A = [Jan 1, +∞)  B = [Jun 1, Jul 1)  → overlaps
    expect(
      rangesOverlap(
        { effectiveFrom: '2026-01-01', effectiveTo: null },
        { effectiveFrom: '2026-06-01', effectiveTo: '2026-07-01' },
      ),
    ).toBe(true);
  });

  it('two open-ended ranges always overlap when both from < the other far future', () => {
    expect(
      rangesOverlap(
        { effectiveFrom: '2026-01-01', effectiveTo: null },
        { effectiveFrom: '2027-01-01', effectiveTo: null },
      ),
    ).toBe(true);
  });
});

describe('hasOverlappingAssignment', () => {
  it('detects any overlap in the list', () => {
    expect(
      hasOverlappingAssignment({ effectiveFrom: '2026-03-01', effectiveTo: '2026-04-01' }, [
        { effectiveFrom: '2026-01-01', effectiveTo: '2026-02-01' },
        { effectiveFrom: '2026-03-15', effectiveTo: '2026-04-15' },
      ]),
    ).toBe(true);
  });

  it('ignores a row matching ignoreId (updating an existing row)', () => {
    expect(
      hasOverlappingAssignment(
        { effectiveFrom: '2026-03-01', effectiveTo: '2026-04-01' },
        [{ id: 'a1', effectiveFrom: '2026-03-01', effectiveTo: '2026-04-01' }],
        'a1',
      ),
    ).toBe(false);
  });
});
