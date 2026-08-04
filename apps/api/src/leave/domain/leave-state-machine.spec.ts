import {
  ForbiddenTransitionError,
  IllegalTransitionError,
  transition,
} from './leave-state-machine';

describe('leave state machine', () => {
  describe('from PENDING_SUPERVISOR', () => {
    it('supervisor APPROVE → PENDING_HR (no balance change)', () => {
      const t = transition('PENDING_SUPERVISOR', { kind: 'APPROVE', actorRole: 'SUPERVISOR' });
      expect(t).toEqual({ next: 'PENDING_HR', reservedDelta: 0, usedDelta: 0 });
    });

    it('HR_MANAGER can also do level-1 approval (bypass for admin ops)', () => {
      expect(
        transition('PENDING_SUPERVISOR', { kind: 'APPROVE', actorRole: 'HR_MANAGER' }).next,
      ).toBe('PENDING_HR');
    });

    it('EMPLOYEE cannot approve — ForbiddenTransitionError', () => {
      expect(() =>
        transition('PENDING_SUPERVISOR', { kind: 'APPROVE', actorRole: 'EMPLOYEE' }),
      ).toThrow(ForbiddenTransitionError);
    });

    it('REJECT releases reserved pool', () => {
      const t = transition('PENDING_SUPERVISOR', { kind: 'REJECT', actorRole: 'SUPERVISOR' });
      expect(t).toEqual({ next: 'REJECTED', reservedDelta: -1, usedDelta: 0 });
    });

    it('CANCEL by owner releases reserved pool', () => {
      const t = transition('PENDING_SUPERVISOR', { kind: 'CANCEL' });
      expect(t).toEqual({ next: 'CANCELLED', reservedDelta: -1, usedDelta: 0 });
    });
  });

  describe('from PENDING_HR', () => {
    it('HR APPROVE moves reserved → used (net-zero to remaining)', () => {
      const t = transition('PENDING_HR', { kind: 'APPROVE', actorRole: 'HR_MANAGER' });
      expect(t).toEqual({ next: 'APPROVED', reservedDelta: -1, usedDelta: +1 });
    });

    it('SUPERVISOR cannot approve at HR stage', () => {
      expect(() =>
        transition('PENDING_HR', { kind: 'APPROVE', actorRole: 'SUPERVISOR' }),
      ).toThrow(ForbiddenTransitionError);
    });

    it('HR REJECT releases reserved without touching used', () => {
      const t = transition('PENDING_HR', { kind: 'REJECT', actorRole: 'HR_MANAGER' });
      expect(t).toEqual({ next: 'REJECTED', reservedDelta: -1, usedDelta: 0 });
    });

    it('CANCEL is allowed at PENDING_HR stage', () => {
      expect(transition('PENDING_HR', { kind: 'CANCEL' }).next).toBe('CANCELLED');
    });
  });

  describe('terminal states', () => {
    for (const state of ['APPROVED', 'REJECTED', 'CANCELLED'] as const) {
      it(`rejects any event from ${state}`, () => {
        expect(() => transition(state, { kind: 'CANCEL' })).toThrow(IllegalTransitionError);
        expect(() =>
          transition(state, { kind: 'APPROVE', actorRole: 'HR_MANAGER' }),
        ).toThrow(IllegalTransitionError);
      });
    }
  });
});
