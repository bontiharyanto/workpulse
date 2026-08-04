import {
  generateBackupCode,
  generateBackupCodes,
  hashBackupCode,
  normalizeBackupCode,
} from './backup-codes';

describe('mfa/domain/backup-codes', () => {
  describe('generateBackupCode', () => {
    it('returns a 10-character code in the fixed alphabet', () => {
      for (let i = 0; i < 100; i += 1) {
        const code = generateBackupCode();
        expect(code).toHaveLength(10);
        expect(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/.test(code)).toBe(true);
      }
    });
  });

  describe('generateBackupCodes', () => {
    it('produces N distinct codes', () => {
      const codes = generateBackupCodes(8);
      expect(codes).toHaveLength(8);
      expect(new Set(codes).size).toBe(8);
    });

    it('supports counts from 4 to 20', () => {
      expect(generateBackupCodes(4)).toHaveLength(4);
      expect(generateBackupCodes(20)).toHaveLength(20);
    });
  });

  describe('normalizeBackupCode', () => {
    it('uppercases and strips whitespace + dashes', () => {
      expect(normalizeBackupCode('abcd-efgh12')).toBe('ABCDEFGH12');
      expect(normalizeBackupCode('  ab cd ef gh 12  ')).toBe('ABCDEFGH12');
      expect(normalizeBackupCode('ab_cd_ef_gh_12')).toBe('ABCDEFGH12');
    });
  });

  describe('hashBackupCode', () => {
    it('is deterministic and normalized-invariant', () => {
      const canonical = 'ABCD-EFGH-12';
      const messy = ' abcdefgh 12 ';
      expect(hashBackupCode(canonical)).toBe(hashBackupCode(messy));
    });

    it('produces a 64-char hex digest', () => {
      expect(hashBackupCode('anything')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is different for different codes', () => {
      expect(hashBackupCode('ABCDEFGH12')).not.toBe(hashBackupCode('ABCDEFGH13'));
    });
  });
});
