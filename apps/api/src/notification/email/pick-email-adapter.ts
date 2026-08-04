import { Logger } from '@nestjs/common';

import type { EmailAdapter } from './email-adapter';

/**
 * Pure branching for the DI factory in `NotificationModule`. Extracted
 * so it can be unit-tested without booting the full Nest graph.
 *
 * Contract:
 *   * `disabled` → `DisabledEmailAdapter` (in-app notifications still
 *     land, but nothing leaves the process).
 *   * `smtp` + `smtpAdapter != null` → SMTP.
 *   * `smtp` + `smtpAdapter == null` → console, with a WARN log so the
 *     operator notices the misconfig. Env validation should catch this
 *     first; this is the runtime safety net.
 *   * anything else / omitted → console (dev default).
 */
export function pickEmailAdapter(
  transport: string | undefined,
  consoleAdapter: EmailAdapter,
  disabledAdapter: EmailAdapter,
  smtpAdapter: EmailAdapter | null,
  logger: Logger = new Logger('EmailAdapterFactory'),
): EmailAdapter {
  switch (transport) {
    case 'disabled':
      logger.log('EMAIL_TRANSPORT=disabled — no emails will be delivered');
      return disabledAdapter;
    case 'smtp':
      if (!smtpAdapter) {
        logger.warn(
          'EMAIL_TRANSPORT=smtp but SmtpEmailAdapter did not initialise. Falling back to console.',
        );
        return consoleAdapter;
      }
      logger.log('EMAIL_TRANSPORT=smtp — using nodemailer transport');
      return smtpAdapter;
    case 'console':
    default:
      logger.log('EMAIL_TRANSPORT=console — emails will be logged only');
      return consoleAdapter;
  }
}
