import { Logger } from '@nestjs/common';

import type { EmailAdapter } from './email-adapter';
import { pickEmailAdapter } from './pick-email-adapter';

function fake(name: string): EmailAdapter {
  return { transport: name, send: async () => undefined };
}

const silentLogger = new Logger('spec');
jest.spyOn(silentLogger, 'log').mockImplementation(() => undefined);
jest.spyOn(silentLogger, 'warn').mockImplementation(() => undefined);

describe('pickEmailAdapter', () => {
  const consoleAdapter = fake('console');
  const disabledAdapter = fake('disabled');
  const smtpAdapter = fake('smtp');

  it('returns disabled for EMAIL_TRANSPORT=disabled', () => {
    expect(
      pickEmailAdapter('disabled', consoleAdapter, disabledAdapter, smtpAdapter, silentLogger)
        .transport,
    ).toBe('disabled');
  });

  it('returns smtp when EMAIL_TRANSPORT=smtp and the smtp adapter exists', () => {
    expect(
      pickEmailAdapter('smtp', consoleAdapter, disabledAdapter, smtpAdapter, silentLogger)
        .transport,
    ).toBe('smtp');
  });

  it('falls back to console when EMAIL_TRANSPORT=smtp but the smtp adapter is null', () => {
    const warn = jest.spyOn(silentLogger, 'warn').mockImplementation(() => undefined);
    const out = pickEmailAdapter('smtp', consoleAdapter, disabledAdapter, null, silentLogger);
    expect(out.transport).toBe('console');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not initialise'));
  });

  it('returns console for EMAIL_TRANSPORT=console', () => {
    expect(
      pickEmailAdapter('console', consoleAdapter, disabledAdapter, smtpAdapter, silentLogger)
        .transport,
    ).toBe('console');
  });

  it('defaults to console for undefined / unknown transport values', () => {
    expect(
      pickEmailAdapter(undefined, consoleAdapter, disabledAdapter, smtpAdapter, silentLogger)
        .transport,
    ).toBe('console');
    expect(
      pickEmailAdapter('mailgun', consoleAdapter, disabledAdapter, smtpAdapter, silentLogger)
        .transport,
    ).toBe('console');
  });
});
