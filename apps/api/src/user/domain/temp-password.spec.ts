import { generateTempPassword } from './temp-password';

describe('generateTempPassword', () => {
  it('produces a password of the requested length', () => {
    expect(generateTempPassword(14)).toHaveLength(14);
    expect(generateTempPassword(20)).toHaveLength(20);
  });

  it('refuses to produce a short (< 8) password', () => {
    expect(() => generateTempPassword(7)).toThrow(RangeError);
  });

  it('contains at least one letter, one digit and one symbol', () => {
    for (let i = 0; i < 200; i += 1) {
      const pwd = generateTempPassword();
      expect(pwd).toMatch(/[a-zA-Z]/);
      expect(pwd).toMatch(/[0-9]/);
      expect(pwd).toMatch(/[!@#%&*]/);
    }
  });

  it('avoids visually confusable characters (0/O, 1/I/l)', () => {
    for (let i = 0; i < 200; i += 1) {
      const pwd = generateTempPassword();
      expect(pwd).not.toMatch(/[0OIl1]/);
    }
  });

  it('has extremely low collision probability across many draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5_000; i += 1) {
      seen.add(generateTempPassword(14));
    }
    expect(seen.size).toBe(5_000);
  });
});
