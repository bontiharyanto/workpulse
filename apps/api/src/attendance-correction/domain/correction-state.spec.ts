import {
  ForbiddenCorrectionTransitionError,
  IllegalCorrectionTransitionError,
  transition,
} from './correction-state';

describe('correction-state.transition', () => {
  describe('APPROVE', () => {
    it('advances PENDING_APPROVAL → APPROVED for an HR actor', () => {
      expect(
        transition('PENDING_APPROVAL', {
          kind: 'APPROVE',
          actorRole: 'HR_MANAGER',
          isTeamSupervisor: false,
        }),
      ).toBe('APPROVED');
    });

    it('advances for a supervisor of the team', () => {
      expect(
        transition('PENDING_APPROVAL', {
          kind: 'APPROVE',
          actorRole: 'SUPERVISOR',
          isTeamSupervisor: true,
        }),
      ).toBe('APPROVED');
    });

    it('rejects a supervisor who is NOT the team supervisor', () => {
      expect(() =>
        transition('PENDING_APPROVAL', {
          kind: 'APPROVE',
          actorRole: 'SUPERVISOR',
          isTeamSupervisor: false,
        }),
      ).toThrow(ForbiddenCorrectionTransitionError);
    });

    it('rejects an EMPLOYEE actor even if they own the request', () => {
      expect(() =>
        transition('PENDING_APPROVAL', {
          kind: 'APPROVE',
          actorRole: 'EMPLOYEE',
          isTeamSupervisor: false,
        }),
      ).toThrow(ForbiddenCorrectionTransitionError);
    });

    it('is illegal on a terminal state', () => {
      expect(() =>
        transition('APPROVED', {
          kind: 'APPROVE',
          actorRole: 'HR_MANAGER',
          isTeamSupervisor: false,
        }),
      ).toThrow(IllegalCorrectionTransitionError);
    });
  });

  describe('REJECT', () => {
    it('advances PENDING_APPROVAL → REJECTED with the same actor gates', () => {
      expect(
        transition('PENDING_APPROVAL', {
          kind: 'REJECT',
          actorRole: 'SUPER_ADMIN',
          isTeamSupervisor: false,
        }),
      ).toBe('REJECTED');
    });
  });

  describe('CANCEL', () => {
    it('advances PENDING_APPROVAL → CANCELLED when the actor owns the row', () => {
      expect(transition('PENDING_APPROVAL', { kind: 'CANCEL', actorIsOwner: true })).toBe(
        'CANCELLED',
      );
    });

    it('rejects a non-owner cancel', () => {
      expect(() => transition('PENDING_APPROVAL', { kind: 'CANCEL', actorIsOwner: false })).toThrow(
        ForbiddenCorrectionTransitionError,
      );
    });

    it('is illegal on a terminal state', () => {
      expect(() => transition('APPROVED', { kind: 'CANCEL', actorIsOwner: true })).toThrow(
        IllegalCorrectionTransitionError,
      );
    });
  });
});
