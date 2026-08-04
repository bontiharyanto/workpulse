import { BreachStatus } from '@prisma/client';

import {
  IllegalBreachTransitionError,
  isDeadlineActive,
  isTerminal,
  transition,
} from './state-machine';

describe('transition', () => {
  it('advances DETECTED -> CONTAINED via MARK_CONTAINED', () => {
    expect(transition(BreachStatus.DETECTED, 'MARK_CONTAINED')).toBe(BreachStatus.CONTAINED);
  });

  it('advances DETECTED -> NOTIFIED_AUTHORITY directly', () => {
    expect(transition(BreachStatus.DETECTED, 'MARK_AUTHORITY_NOTIFIED')).toBe(
      BreachStatus.NOTIFIED_AUTHORITY,
    );
  });

  it('advances CONTAINED -> NOTIFIED_AUTHORITY', () => {
    expect(transition(BreachStatus.CONTAINED, 'MARK_AUTHORITY_NOTIFIED')).toBe(
      BreachStatus.NOTIFIED_AUTHORITY,
    );
  });

  it('advances NOTIFIED_AUTHORITY -> NOTIFIED_SUBJECTS', () => {
    expect(transition(BreachStatus.NOTIFIED_AUTHORITY, 'MARK_SUBJECTS_NOTIFIED')).toBe(
      BreachStatus.NOTIFIED_SUBJECTS,
    );
  });

  it('closes from NOTIFIED_SUBJECTS', () => {
    expect(transition(BreachStatus.NOTIFIED_SUBJECTS, 'CLOSE')).toBe(BreachStatus.CLOSED);
  });

  it('allows escape-hatch CLOSE from DETECTED / CONTAINED / NOTIFIED_AUTHORITY', () => {
    expect(transition(BreachStatus.DETECTED, 'CLOSE')).toBe(BreachStatus.CLOSED);
    expect(transition(BreachStatus.CONTAINED, 'CLOSE')).toBe(BreachStatus.CLOSED);
    expect(transition(BreachStatus.NOTIFIED_AUTHORITY, 'CLOSE')).toBe(BreachStatus.CLOSED);
  });

  it('refuses to rewind — no CLOSED -> anything', () => {
    expect(() => transition(BreachStatus.CLOSED, 'CLOSE')).toThrow(IllegalBreachTransitionError);
    expect(() => transition(BreachStatus.CLOSED, 'MARK_CONTAINED')).toThrow(
      IllegalBreachTransitionError,
    );
  });

  it('refuses to skip stages backwards', () => {
    expect(() => transition(BreachStatus.NOTIFIED_SUBJECTS, 'MARK_CONTAINED')).toThrow(
      IllegalBreachTransitionError,
    );
    expect(() => transition(BreachStatus.CONTAINED, 'MARK_SUBJECTS_NOTIFIED')).toThrow(
      IllegalBreachTransitionError,
    );
  });
});

describe('isTerminal', () => {
  it('CLOSED is terminal, others are not', () => {
    expect(isTerminal(BreachStatus.CLOSED)).toBe(true);
    for (const s of [
      BreachStatus.DETECTED,
      BreachStatus.CONTAINED,
      BreachStatus.NOTIFIED_AUTHORITY,
      BreachStatus.NOTIFIED_SUBJECTS,
    ]) {
      expect(isTerminal(s)).toBe(false);
    }
  });
});

describe('isDeadlineActive', () => {
  it('is active only in pre-notification statuses', () => {
    expect(isDeadlineActive(BreachStatus.DETECTED)).toBe(true);
    expect(isDeadlineActive(BreachStatus.CONTAINED)).toBe(true);
    expect(isDeadlineActive(BreachStatus.NOTIFIED_AUTHORITY)).toBe(false);
    expect(isDeadlineActive(BreachStatus.NOTIFIED_SUBJECTS)).toBe(false);
    expect(isDeadlineActive(BreachStatus.CLOSED)).toBe(false);
  });
});
