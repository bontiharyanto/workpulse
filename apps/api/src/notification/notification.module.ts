import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaModule } from '../prisma/prisma.module';
import { ConsoleEmailAdapter, DisabledEmailAdapter } from './email/console-email-adapter';
import { EMAIL_ADAPTER, type EmailAdapter } from './email/email-adapter';
import { pickEmailAdapter } from './email/pick-email-adapter';
import { SmtpEmailAdapter } from './email/smtp-email-adapter';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

/**
 * The email adapter is picked from `EMAIL_TRANSPORT` at bootstrap:
 *
 *   * `console` — logs every message (default dev)
 *   * `disabled` — no-op (isolated E2E)
 *   * `smtp` — production, nodemailer-backed. Requires `SMTP_HOST` /
 *     `SMTP_PORT`; env validation rejects the combo `EMAIL_TRANSPORT=smtp`
 *     without those.
 *
 * All three concrete adapters are provided so the DI graph resolves
 * cleanly for tests that override `EMAIL_ADAPTER` directly.
 */
@Module({
  imports: [PrismaModule],
  controllers: [NotificationController],
  providers: [
    ConsoleEmailAdapter,
    DisabledEmailAdapter,
    {
      provide: SmtpEmailAdapter,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): SmtpEmailAdapter | null => {
        // Instantiate the SMTP adapter lazily so environments without
        // SMTP creds do not need to satisfy the transporter's runtime
        // requirements. The factory below only ever asks for this
        // instance when `EMAIL_TRANSPORT=smtp`, which the env schema
        // already gates.
        if (cfg.get<string>('EMAIL_TRANSPORT') !== 'smtp') return null;
        return new SmtpEmailAdapter(cfg);
      },
    },
    {
      provide: EMAIL_ADAPTER,
      inject: [ConfigService, ConsoleEmailAdapter, DisabledEmailAdapter, SmtpEmailAdapter],
      useFactory: (
        cfg: ConfigService,
        consoleAdapter: ConsoleEmailAdapter,
        disabledAdapter: DisabledEmailAdapter,
        smtpAdapter: SmtpEmailAdapter | null,
      ): EmailAdapter =>
        pickEmailAdapter(
          cfg.get<string>('EMAIL_TRANSPORT', 'console'),
          consoleAdapter,
          disabledAdapter,
          smtpAdapter,
        ),
    },
    NotificationService,
    NotificationPreferenceService,
  ],
  exports: [NotificationService, NotificationPreferenceService, EMAIL_ADAPTER],
})
export class NotificationModule {}
