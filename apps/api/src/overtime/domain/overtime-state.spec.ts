import type { OvertimeStatus } from '@prisma/client';

import { ForbiddenTransitionError, IllegalTransitionError, transition } from './overtime-state';

describe('overtime-state.transition', () => {
  describe('approve', () => {
    it('supervisor of the team → APPROVED', () => {
      expect(
        transition('PENDING_APPROVAL', {
          kind: 'APPROVE',
          actorRole: 'SUPERVISOR',
          isTeamSupervisor: true,
        }),
      ).toBe('APPROVED');
    });

    it('HR can decide anywhere', () => {
      expect(
        transition('PENDING_APPROVAL', {
          kind: 'APPROVE',
          actorRole: 'HR_MANAGER',
          isTeamSupervisor: false,
        }),
      ).toBe('APPROVED');
    });

    it('supervisor not in the chain → FORBIDDEN', () => {
      expect(() =>
        transition('PENDING_APPROVAL', {
          kind: 'APPROVE',
          actorRole: 'SUPERVISOR',
          isTeamSupervisor: false,
        }),
      ).toThrow(ForbiddenTransitionError);
    });

    it('employee cannot approve', () => {
      expect(() =>
        transition('PENDING_APPROVAL', {
          kind: 'APPROVE',
          actorRole: 'EMPLOYEE',
          isTeamSupervisor: false,
        }),
      ).toThrow(ForbiddenTransitionError);
    });

    it('rejects transition from non-PENDING', () => {
      const terminals: OvertimeStatus[] = ['APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'];
      for (const from of terminals) {
        expect(() =>
          transition(from, {
            kind: 'APPROVE',
            actorRole: 'HR_MANAGER',
            isTeamSupervisor: false,
          }),
        ).toThrow(IllegalTransitionError);
      }
    });
  });

  describe('reject', () => {
    it('rejects a pending request', () => {
      expect(
        transition('PENDING_APPROVAL', {
          kind: 'REJECT',
          actorRole: 'SUPERVISOR',
          isTeamSupervisor: true,
        }),
      ).toBe('REJECTED');
    });
  });

  describe('cancel', () => {
    it('owner can cancel pending', () => {
      expect(transition('PENDING_APPROVAL', { kind: 'CANCEL', actorIsOwner: true })).toBe(
        'CANCELLED',
      );
    });

    it('non-owner cannot cancel', () => {
      expect(() => transition('PENDING_APPROVAL', { kind: 'CANCEL', actorIsOwner: false })).toThrow(
        ForbiddenTransitionError,
      );
    });

    it('cannot cancel already-approved', () => {
      expect(() => transition('APPROVED', { kind: 'CANCEL', actorIsOwner: true })).toThrow(
        IllegalTransitionError,
      );
    });
  });

  describe('complete', () => {
    it('APPROVED → COMPLETED', () => {
      expect(transition('APPROVED', { kind: 'COMPLETE' })).toBe('COMPLETED');
    });

    it('cannot complete a non-approved row', () => {
      expect(() => transition('PENDING_APPROVAL', { kind: 'COMPLETE' })).toThrow(
        IllegalTransitionError,
      );
    });
  });
});
