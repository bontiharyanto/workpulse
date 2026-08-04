import type { RopaVersionStatus } from '@prisma/client';

import {
  IllegalRopaTransitionError,
  isCurrent,
  isEditable,
  transition,
  type RopaTransition,
} from './version-state-machine';

const ALL_STATUSES: RopaVersionStatus[] = ['DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED'];
const ALL_ACTIONS: RopaTransition[] = ['SUBMIT_REVIEW', 'RETURN_TO_DRAFT', 'PUBLISH', 'ARCHIVE'];

type Legal = {
  from: RopaVersionStatus;
  action: RopaTransition;
  to: RopaVersionStatus;
};

const LEGAL_TRANSITIONS: Legal[] = [
  { from: 'DRAFT', action: 'SUBMIT_REVIEW', to: 'REVIEW' },
  { from: 'REVIEW', action: 'RETURN_TO_DRAFT', to: 'DRAFT' },
  { from: 'REVIEW', action: 'PUBLISH', to: 'PUBLISHED' },
  { from: 'PUBLISHED', action: 'ARCHIVE', to: 'ARCHIVED' },
  { from: 'ARCHIVED', action: 'ARCHIVE', to: 'ARCHIVED' },
];

describe('RopaVersion state machine', () => {
  describe('legal transitions', () => {
    for (const t of LEGAL_TRANSITIONS) {
      it(`${t.from} --${t.action}--> ${t.to}`, () => {
        expect(transition(t.from, t.action)).toBe(t.to);
      });
    }
  });

  describe('illegal transitions', () => {
    const legalKey = (t: Legal): string => `${t.from}::${t.action}`;
    const legalSet = new Set(LEGAL_TRANSITIONS.map(legalKey));

    for (const from of ALL_STATUSES) {
      for (const action of ALL_ACTIONS) {
        if (legalSet.has(`${from}::${action}`)) continue;
        it(`${from} --${action}--> throws IllegalRopaTransitionError`, () => {
          try {
            transition(from, action);
            fail(`Expected transition to throw for ${from}/${action}`);
          } catch (err) {
            expect(err).toBeInstanceOf(IllegalRopaTransitionError);
            const casted = err as IllegalRopaTransitionError;
            expect(casted.from).toBe(from);
            expect(casted.attempted).toBe(action);
            expect(casted.code).toBe('ROPA_ILLEGAL_TRANSITION');
          }
        });
      }
    }
  });

  describe('isEditable guard', () => {
    it('only DRAFT is editable', () => {
      expect(isEditable('DRAFT')).toBe(true);
      expect(isEditable('REVIEW')).toBe(false);
      expect(isEditable('PUBLISHED')).toBe(false);
      expect(isEditable('ARCHIVED')).toBe(false);
    });
  });

  describe('isCurrent guard', () => {
    it('only PUBLISHED counts as the current record', () => {
      expect(isCurrent('PUBLISHED')).toBe(true);
      expect(isCurrent('DRAFT')).toBe(false);
      expect(isCurrent('REVIEW')).toBe(false);
      expect(isCurrent('ARCHIVED')).toBe(false);
    });
  });
});
