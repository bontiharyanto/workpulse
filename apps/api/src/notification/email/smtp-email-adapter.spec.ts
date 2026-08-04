import type { ConfigService } from '@nestjs/config';

import { SmtpEmailAdapter } from './smtp-email-adapter';

/**
 * Mock the full nodemailer surface. The adapter never inspects the
 * transporter beyond `sendMail`, `verify`, and `close`, so a hand-rolled
 * fake is easier to reason about than `jest.mock('nodemailer')` +
 * spy chains.
 */
const sendMail = jest.fn();
const verify = jest.fn();
const close = jest.fn();

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(() => ({ sendMail, verify, close })),
  },
}));

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const base: Record<string, unknown> = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: 'user@example.com',
    SMTP_PASS: 'super-secret',
    EMAIL_FROM: 'Workpulse <no-reply@example.com>',
    SMTP_VERIFY_ON_BOOT: 'false',
    ...overrides,
  };
  return {
    get: <T,>(key: string, def?: T): T | undefined =>
      (base[key] as T | undefined) ?? def,
    getOrThrow: <T,>(key: string): T => {
      if (base[key] === undefined) throw new Error(`missing ${key}`);
      return base[key] as T;
    },
  } as unknown as ConfigService;
}

describe('SmtpEmailAdapter', () => {
  beforeEach(() => {
    sendMail.mockReset();
    verify.mockReset();
    close.mockReset();
  });

  it('reports transport = "smtp"', () => {
    const adapter = new SmtpEmailAdapter(makeConfig());
    expect(adapter.transport).toBe('smtp');
  });

  it('forwards the message through nodemailer with the configured `from`', async () => {
    sendMail.mockResolvedValue({ messageId: '<abc@example.com>' });
    const adapter = new SmtpEmailAdapter(makeConfig());
    await adapter.send({
      to: 'jane@example.com',
      subject: 'Reset password',
      body: 'Klik tautan berikut untuk reset password.',
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Workpulse <no-reply@example.com>',
      to: 'jane@example.com',
      subject: 'Reset password',
      text: 'Klik tautan berikut untuk reset password.',
    });
  });

  it('never throws when nodemailer rejects (business op must not roll back)', async () => {
    sendMail.mockRejectedValue(new Error('EAUTH'));
    const adapter = new SmtpEmailAdapter(makeConfig());
    await expect(
      adapter.send({ to: 'x', subject: 'y', body: 'z' }),
    ).resolves.toBeUndefined();
  });

  it('omits auth when SMTP_USER/PASS are absent (open-relay dev servers)', async () => {
    const nodemailer = jest.requireMock('nodemailer') as {
      default: { createTransport: jest.Mock };
    };
    nodemailer.default.createTransport.mockClear();
    new SmtpEmailAdapter(makeConfig({ SMTP_USER: undefined, SMTP_PASS: undefined }));
    const opts = nodemailer.default.createTransport.mock.calls[0]?.[0] as {
      auth?: unknown;
    };
    expect(opts.auth).toBeUndefined();
  });

  it('closes the transporter on module destroy', () => {
    const adapter = new SmtpEmailAdapter(makeConfig());
    adapter.onModuleDestroy();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('kicks off a verify handshake at boot only when SMTP_VERIFY_ON_BOOT=true', () => {
    verify.mockResolvedValue(undefined);
    new SmtpEmailAdapter(makeConfig({ SMTP_VERIFY_ON_BOOT: 'false' }));
    expect(verify).not.toHaveBeenCalled();

    new SmtpEmailAdapter(makeConfig({ SMTP_VERIFY_ON_BOOT: 'true' }));
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('swallows verify() failures instead of crashing the app', () => {
    verify.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(() =>
      new SmtpEmailAdapter(makeConfig({ SMTP_VERIFY_ON_BOOT: 'true' })),
    ).not.toThrow();
  });
});
