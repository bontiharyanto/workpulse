import { TimesheetStatus } from '@prisma/client';

import {
  ForbiddenTimesheetTransitionError,
  IllegalTimesheetTransitionError,
  isRegenerateLocked,
  transition,
  type WorkflowAction,
} from './submission-workflow';

describe('submission-workflow — SUBMIT', () => {
  const submitOwner: WorkflowAction = { kind: 'SUBMIT', actorIsOwner: true };

  it('promotes DRAFT → PENDING_SUPERVISOR', () => {
    expect(transition(TimesheetStatus.DRAFT, submitOwner)).toBe(TimesheetStatus.PENDING_SUPERVISOR);
  });

  it('promotes REJECTED → PENDING_SUPERVISOR (re-submit)', () => {
    expect(transition(TimesheetStatus.REJECTED, submitOwner)).toBe(
      TimesheetStatus.PENDING_SUPERVISOR,
    );
  });

  it('refuses non-owner submitters as forbidden, not illegal', () => {
    expect(() =>
      transition(TimesheetStatus.DRAFT, {
        kind: 'SUBMIT',
        actorIsOwner: false,
      }),
    ).toThrow(ForbiddenTimesheetTransitionError);
  });

  it('is illegal from any non-terminal state (PENDING_HR, APPROVED, PENDING_SUPERVISOR)', () => {
    for (const from of [
      TimesheetStatus.PENDING_SUPERVISOR,
      TimesheetStatus.PENDING_HR,
      TimesheetStatus.APPROVED,
    ]) {
      expect(() => transition(from, submitOwner)).toThrow(IllegalTimesheetTransitionError);
    }
  });
});

describe('submission-workflow — SUPERVISOR_APPROVE / REJECT', () => {
  const teamSupervisor: WorkflowAction = {
    kind: 'SUPERVISOR_APPROVE',
    actorRole: 'SUPERVISOR',
    isTeamSupervisor: true,
  };

  it('promotes PENDING_SUPERVISOR → PENDING_HR when the actor is the direct supervisor', () => {
    expect(transition(TimesheetStatus.PENDING_SUPERVISOR, teamSupervisor)).toBe(
      TimesheetStatus.PENDING_HR,
    );
  });

  it('allows HR_MANAGER to short-circuit the supervisor tier', () => {
    expect(
      transition(TimesheetStatus.PENDING_SUPERVISOR, {
        kind: 'SUPERVISOR_APPROVE',
        actorRole: 'HR_MANAGER',
        isTeamSupervisor: false,
      }),
    ).toBe(TimesheetStatus.PENDING_HR);
  });

  it('forbids a non-team SUPERVISOR', () => {
    expect(() =>
      transition(TimesheetStatus.PENDING_SUPERVISOR, {
        kind: 'SUPERVISOR_APPROVE',
        actorRole: 'SUPERVISOR',
        isTeamSupervisor: false,
      }),
    ).toThrow(ForbiddenTimesheetTransitionError);
  });

  it('is illegal from DRAFT / PENDING_HR / APPROVED', () => {
    for (const from of [
      TimesheetStatus.DRAFT,
      TimesheetStatus.PENDING_HR,
      TimesheetStatus.APPROVED,
    ]) {
      expect(() => transition(from, teamSupervisor)).toThrow(IllegalTimesheetTransitionError);
    }
  });

  it('rejects PENDING_SUPERVISOR → REJECTED', () => {
    expect(
      transition(TimesheetStatus.PENDING_SUPERVISOR, {
        kind: 'SUPERVISOR_REJECT',
        actorRole: 'SUPERVISOR',
        isTeamSupervisor: true,
      }),
    ).toBe(TimesheetStatus.REJECTED);
  });
});

describe('submission-workflow — HR_APPROVE / REJECT', () => {
  it('promotes PENDING_HR → APPROVED for HR_MANAGER', () => {
    expect(
      transition(TimesheetStatus.PENDING_HR, {
        kind: 'HR_APPROVE',
        actorRole: 'HR_MANAGER',
      }),
    ).toBe(TimesheetStatus.APPROVED);
  });

  it('promotes PENDING_HR → APPROVED for SUPER_ADMIN', () => {
    expect(
      transition(TimesheetStatus.PENDING_HR, {
        kind: 'HR_APPROVE',
        actorRole: 'SUPER_ADMIN',
      }),
    ).toBe(TimesheetStatus.APPROVED);
  });

  it('forbids a SUPERVISOR from HR-tier decisions', () => {
    expect(() =>
      transition(TimesheetStatus.PENDING_HR, {
        kind: 'HR_APPROVE',
        actorRole: 'SUPERVISOR',
      }),
    ).toThrow(ForbiddenTimesheetTransitionError);
  });

  it('is illegal on any state other than PENDING_HR', () => {
    for (const from of [
      TimesheetStatus.DRAFT,
      TimesheetStatus.PENDING_SUPERVISOR,
      TimesheetStatus.APPROVED,
      TimesheetStatus.REJECTED,
    ]) {
      expect(() => transition(from, { kind: 'HR_APPROVE', actorRole: 'HR_MANAGER' })).toThrow(
        IllegalTimesheetTransitionError,
      );
    }
  });

  it('rejects PENDING_HR → REJECTED for HR', () => {
    expect(
      transition(TimesheetStatus.PENDING_HR, {
        kind: 'HR_REJECT',
        actorRole: 'HR_MANAGER',
      }),
    ).toBe(TimesheetStatus.REJECTED);
  });
});

describe('submission-workflow — isRegenerateLocked', () => {
  it('locks only APPROVED', () => {
    expect(isRegenerateLocked(TimesheetStatus.APPROVED)).toBe(true);
    for (const s of [
      TimesheetStatus.DRAFT,
      TimesheetStatus.PENDING_SUPERVISOR,
      TimesheetStatus.PENDING_HR,
      TimesheetStatus.REJECTED,
    ]) {
      expect(isRegenerateLocked(s)).toBe(false);
    }
  });
});
