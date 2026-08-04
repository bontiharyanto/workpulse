import { DpiaStatus } from '@prisma/client';

import { IllegalDpiaTransitionError, isCurrent, isEditable, transition } from './state-machine';

describe('DPIA state machine', () => {
  it('DRAFT → REVIEW via SUBMIT_REVIEW', () => {
    expect(transition(DpiaStatus.DRAFT, 'SUBMIT_REVIEW')).toBe(DpiaStatus.REVIEW);
  });
  it('REVIEW → DRAFT via RETURN_TO_DRAFT', () => {
    expect(transition(DpiaStatus.REVIEW, 'RETURN_TO_DRAFT')).toBe(DpiaStatus.DRAFT);
  });
  it('REVIEW → APPROVED via APPROVE', () => {
    expect(transition(DpiaStatus.REVIEW, 'APPROVE')).toBe(DpiaStatus.APPROVED);
  });
  it('APPROVED → ARCHIVED via ARCHIVE', () => {
    expect(transition(DpiaStatus.APPROVED, 'ARCHIVE')).toBe(DpiaStatus.ARCHIVED);
  });
  it('refuses illegal jumps', () => {
    expect(() => transition(DpiaStatus.DRAFT, 'APPROVE')).toThrow(IllegalDpiaTransitionError);
    expect(() => transition(DpiaStatus.ARCHIVED, 'SUBMIT_REVIEW')).toThrow(
      IllegalDpiaTransitionError,
    );
  });
  it('isEditable is true only for DRAFT', () => {
    expect(isEditable(DpiaStatus.DRAFT)).toBe(true);
    expect(isEditable(DpiaStatus.REVIEW)).toBe(false);
  });
  it('isCurrent is true only for APPROVED', () => {
    expect(isCurrent(DpiaStatus.APPROVED)).toBe(true);
    expect(isCurrent(DpiaStatus.DRAFT)).toBe(false);
  });
});
