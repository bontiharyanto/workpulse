import { authenticator } from 'otplib';

import { generateTotpEnrollment, verifyTotp } from './totp';

describe('mfa/domain/totp', () => {
  describe('generateTotpEnrollment', () => {
    it('returns a base32 secret and an otpauth URL', () => {
      const enrollment = generateTotpEnrollment({
        accountName: 'jane@example.com',
        issuer: 'Workpulse',
      });
      expect(enrollment.secret).toMatch(/^[A-Z2-7]+$/);
      expect(enrollment.otpauthUrl.startsWith('otpauth://totp/')).toBe(true);
      expect(enrollment.otpauthUrl).toContain('issuer=Workpulse');
      expect(enrollment.otpauthUrl).toContain('secret=' + enrollment.secret);
    });
  });

  describe('verifyTotp', () => {
    it('accepts the current code for the given secret', () => {
      const { secret } = generateTotpEnrollment({
        accountName: 'x',
        issuer: 'y',
      });
      const code = authenticator.generate(secret);
      expect(verifyTotp(code, secret)).toBe(true);
    });

    it('rejects an obviously wrong code', () => {
      const { secret } = generateTotpEnrollment({
        accountName: 'x',
        issuer: 'y',
      });
      expect(verifyTotp('000000', secret)).toBe(false);
    });

    it('rejects codes that are not 6 digits', () => {
      const { secret } = generateTotpEnrollment({
        accountName: 'x',
        issuer: 'y',
      });
      expect(verifyTotp('12345', secret)).toBe(false);
      expect(verifyTotp('abcdef', secret)).toBe(false);
      expect(verifyTotp('', secret)).toBe(false);
    });

    it('returns false on a malformed secret without throwing', () => {
      const code = authenticator.generate('JBSWY3DPEHPK3PXP');
      expect(verifyTotp(code, 'not base32 !@#')).toBe(false);
    });
  });
});
