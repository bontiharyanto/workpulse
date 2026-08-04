import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes and verifies a matching password', async () => {
    const hash = await service.hash('correct-horse-battery-staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(service.verify(hash, 'correct-horse-battery-staple')).resolves.toBe(true);
  });

  it('rejects a mismatching password', async () => {
    const hash = await service.hash('secret');
    await expect(service.verify(hash, 'wrong')).resolves.toBe(false);
  });

  it('does not throw on malformed hash — returns false', async () => {
    await expect(service.verify('not-an-argon2-hash', 'x')).resolves.toBe(false);
  });

  it('produces distinct hashes for the same input (random salt)', async () => {
    const [a, b] = await Promise.all([service.hash('same'), service.hash('same')]);
    expect(a).not.toBe(b);
  });
});
