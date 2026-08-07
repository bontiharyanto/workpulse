import { createHash } from 'node:crypto';

import {
  consentCopyIsCurrent,
  LOCATION_SHARING_CONSENT_COPY,
} from '@workpulse/shared-types';

/**
 * Guards the ADR-0041 rollout gate: any change to the consent copy
 * text without regenerating the SHA is a bug that Legal must catch,
 * NOT a runtime surprise. Failing this test is the intended way to
 * fail — see `packages/shared-types/src/consent-copy/location-sharing.ts`
 * for the regen procedure.
 */
describe('LOCATION_SHARING_CONSENT_COPY', () => {
  it('`id` matches SHA-256 of `text` (self-hash contract)', () => {
    const actual = createHash('sha256')
      .update(LOCATION_SHARING_CONSENT_COPY.text)
      .digest('hex');
    expect(actual).toBe(LOCATION_SHARING_CONSENT_COPY.id);
  });

  it('carries a 64-char hex digest as `id`', () => {
    expect(LOCATION_SHARING_CONSENT_COPY.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('body mentions the four ADR-0041 promises the FE relies on', () => {
    const t = LOCATION_SHARING_CONSENT_COPY.text;
    // Not exhaustive — just enough to catch a copy that accidentally
    // drops one of the material promises without a matching Legal
    // review. Regenerate the SHA and this test to add/remove
    // promises going forward.
    expect(t).toMatch(/latar belakang/i); // no background tracking
    expect(t).toMatch(/7 hari/); // ping retention
    expect(t).toMatch(/90 hari/); // request retention
    expect(t).toMatch(/UU 27\/2022/); // legal basis
  });

  describe('consentCopyIsCurrent', () => {
    it('returns true only for the current id', () => {
      expect(consentCopyIsCurrent(LOCATION_SHARING_CONSENT_COPY.id)).toBe(true);
    });
    it('returns false for null and stale SHAs', () => {
      expect(consentCopyIsCurrent(null)).toBe(false);
      expect(consentCopyIsCurrent('0'.repeat(64))).toBe(false);
    });
  });
});
