import { Injectable, Logger } from '@nestjs/common';

import type { EmailAdapter, EmailMessage } from './email-adapter';

/**
 * Development-mode adapter — logs every email as a structured log line
 * instead of shipping it anywhere. Useful for E2E tests, seed demos, and
 * local development where nobody wants a real SMTP server.
 *
 * Also serves as the safe default in staging when the real transport is
 * misconfigured: the app still boots, notifications still land in-app,
 * and the log stream captures what *would* have been sent.
 */
@Injectable()
export class ConsoleEmailAdapter implements EmailAdapter {
  readonly transport = 'console';
  private readonly logger = new Logger('EmailAdapter[console]');

  async send(message: EmailMessage): Promise<void> {
    const attach =
      message.attachments && message.attachments.length > 0
        ? ` attachments=${message.attachments
            .map((a) => `${a.filename}(${a.bytes.byteLength}B)`)
            .join(',')}`
        : '';
    this.logger.log(
      `MAIL to=${message.to} subject="${message.subject}" body="${trimForLog(message.body)}"${attach}`,
    );
  }
}

/**
 * No-op adapter used when `EMAIL_TRANSPORT=disabled`. Notifications still
 * persist in-app but nothing is emitted — useful for pure isolated E2E
 * runs where even log noise matters.
 */
@Injectable()
export class DisabledEmailAdapter implements EmailAdapter {
  readonly transport = 'disabled';

  async send(_message: EmailMessage): Promise<void> {
    // no-op
  }
}

function trimForLog(s: string): string {
  const single = s.replace(/\s+/g, ' ').trim();
  return single.length > 200 ? `${single.slice(0, 199)}…` : single;
}
