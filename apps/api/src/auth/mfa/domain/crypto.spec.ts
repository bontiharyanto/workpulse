import { randomBytes } from 'node:crypto';

import {
  DecryptionFailedError,
  InvalidEncryptionKeyError,
  decodeEncryptionKey,
  decryptString,
  encryptString,
} from './crypto';

describe('mfa/domain/crypto', () => {
  const key = randomBytes(32);

  describe('decodeEncryptionKey', () => {
    it('accepts a 32-byte base64 key', () => {
      const b64 = randomBytes(32).toString('base64');
      expect(decodeEncryptionKey(b64)).toHaveLength(32);
    });

    it('rejects a key of the wrong length', () => {
      const b64 = randomBytes(16).toString('base64');
      expect(() => decodeEncryptionKey(b64)).toThrow(InvalidEncryptionKeyError);
    });
  });

  describe('encrypt/decrypt round-trip', () => {
    it('recovers the exact plaintext', () => {
      const secret = 'JBSWY3DPEHPK3PXP'; // canonical TOTP base32 sample
      const enc = encryptString(secret, key);
      expect(decryptString(enc, key)).toBe(secret);
    });

    it('produces distinct ciphertexts for the same plaintext (IV freshness)', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const enc1 = encryptString(secret, key);
      const enc2 = encryptString(secret, key);
      expect(enc1).not.toBe(enc2);
      expect(decryptString(enc1, key)).toBe(secret);
      expect(decryptString(enc2, key)).toBe(secret);
    });

    it('supports unicode plaintext', () => {
      const plain = 'Kunci rahasia — 秘密 🔐';
      const enc = encryptString(plain, key);
      expect(decryptString(enc, key)).toBe(plain);
    });
  });

  describe('decrypt failure modes', () => {
    it('throws when the ciphertext has been tampered', () => {
      const enc = encryptString('secret', key);
      const tampered = Buffer.from(enc, 'base64');
      const lastIdx = tampered.length - 1;
      tampered.writeUInt8((tampered.readUInt8(lastIdx) ^ 0x01) & 0xff, lastIdx);
      expect(() => decryptString(tampered.toString('base64'), key)).toThrow(DecryptionFailedError);
    });

    it('throws when decrypted with a different key', () => {
      const enc = encryptString('secret', key);
      const wrongKey = randomBytes(32);
      expect(() => decryptString(enc, wrongKey)).toThrow(DecryptionFailedError);
    });

    it('throws on obviously malformed input', () => {
      expect(() => decryptString('not-a-bundle', key)).toThrow(DecryptionFailedError);
      expect(() => decryptString('', key)).toThrow(DecryptionFailedError);
    });
  });
});
