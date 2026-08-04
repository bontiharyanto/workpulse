import { buildResetLinkEmail } from './reset-email';

describe('buildResetLinkEmail', () => {
  const base = {
    toEmail: 'ana@example.com',
    displayName: 'Ana',
    resetUrl: 'https://app.workpulse.local/reset-password?token=abc',
    expiresInMinutes: 30,
  };

  it('greets by display name when present', () => {
    const email = buildResetLinkEmail(base);
    expect(email.body).toContain('Halo Ana');
  });

  it('falls back to a generic greeting for blank display names', () => {
    const email = buildResetLinkEmail({ ...base, displayName: '   ' });
    expect(email.body).toContain('Rekan Workpulse');
  });

  it('includes the destination email so the recipient knows which account', () => {
    const email = buildResetLinkEmail(base);
    expect(email.body).toContain('ana@example.com');
  });

  it('includes the reset URL on its own line for easy click / copy', () => {
    const email = buildResetLinkEmail(base);
    expect(email.body).toContain(base.resetUrl);
  });

  it('mentions the TTL so the user knows to act quickly', () => {
    const email = buildResetLinkEmail({ ...base, expiresInMinutes: 15 });
    expect(email.body).toContain('15 menit');
  });

  it('routes to the requested email address with a stable subject', () => {
    const email = buildResetLinkEmail(base);
    expect(email.to).toBe(base.toEmail);
    expect(email.subject).toBe('Reset password Workpulse');
  });

  it('tells the user to ignore the email if unexpected', () => {
    const email = buildResetLinkEmail(base);
    expect(email.body.toLowerCase()).toContain('abaikan');
  });
});
