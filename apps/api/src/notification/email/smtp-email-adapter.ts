import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';

import type { EmailAdapter, EmailMessage } from './email-adapter';

/**
 * SMTP-backed adapter. Uses nodemailer, which is a well-worn library
 * that speaks plain SMTP; the *provider* (Amazon SES, SendGrid,
 * Mailgun, Postmark, …) is negotiated at the transport layer — every
 * one of them ships an SMTP endpoint, so one adapter covers them all.
 *
 * The transporter is pool-mode with a bounded max connection count to
 * avoid hammering the provider from a Node app that scales
 * horizontally. Failure semantics:
 *
 *   * `verify()` runs at boot when explicitly opted-in
 *     (`SMTP_VERIFY_ON_BOOT=true`). We do NOT verify by default
 *     because a provider glitch would otherwise refuse the app to
 *     start — losing every other request too. Better to boot in
 *     "degraded" mode and let the first email failure surface via
 *     structured logs + Sentry.
 *   * `send()` NEVER throws. If nodemailer rejects (e.g. bad DNS,
 *     auth failure, throttling) we log a WARN and return — the
 *     business transaction that scheduled the email is already
 *     committed by that point (see `NotificationService.dispatchEmail`).
 *
 * The transporter is closed on module destroy to release the pool.
 */
@Injectable()
export class SmtpEmailAdapter implements EmailAdapter, OnModuleDestroy {
  readonly transport = 'smtp';
  private readonly logger = new Logger('EmailAdapter[smtp]');
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    const host = config.getOrThrow<string>('SMTP_HOST');
    const port = config.getOrThrow<number>('SMTP_PORT');
    const secure = config.get<boolean>('SMTP_SECURE') === true;
    const user = config.get<string>('SMTP_USER');
    const pass = config.get<string>('SMTP_PASS');
    this.from = config.get<string>('EMAIL_FROM', 'no-reply@workpulse.local');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    });

    this.logger.log(
      `SMTP transport configured host=${host} port=${port} secure=${secure} auth=${
        user ? 'yes' : 'no'
      }`,
    );

    if (config.get<string>('SMTP_VERIFY_ON_BOOT') === 'true') {
      void this.transporter
        .verify()
        .then(() => this.logger.log('SMTP handshake OK'))
        .catch((err: unknown) =>
          this.logger.warn(
            `SMTP handshake failed at boot — continuing anyway: ${(err as Error).message}`,
          ),
        );
    }
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.body,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: a.bytes,
          contentType: a.contentType,
        })),
      });
      // nodemailer's response is provider-specific; log the messageId
      // when we get one (SES + most providers) to make debugging
      // deliverability issues possible.
      const messageId =
        typeof info === 'object' && info !== null && 'messageId' in info
          ? String((info as { messageId?: unknown }).messageId ?? '')
          : '';
      this.logger.debug(
        `MAIL sent to=${message.to} subject="${message.subject}" messageId=${messageId}`,
      );
    } catch (err) {
      this.logger.warn(
        `SMTP send failed to=${message.to} subject="${message.subject}" err=${
          (err as Error).message
        }`,
      );
    }
  }

  onModuleDestroy(): void {
    try {
      this.transporter.close();
    } catch (err) {
      this.logger.warn(`transporter.close() threw: ${(err as Error).message}`);
    }
  }
}
