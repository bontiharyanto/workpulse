/**
 * Transport-agnostic email interface. Implementations live in their own
 * files and are selected by the `EMAIL_TRANSPORT` env var. The service
 * layer depends only on this interface, so swapping SES / SMTP /
 * SendGrid later is a one-file change.
 *
 * Deliberately narrow: no HTML/text distinction, no CC/BCC. Notifications
 * are short one-off messages; if we ever need marketing-style emails
 * we'll build a separate abstraction rather than bloating this one.
 *
 * Attachments (Fase 33c) are supported as an *optional* addendum used
 * only by the scheduled report dispatcher. Regular notification templates
 * never populate this field.
 */

export interface EmailAttachment {
  filename: string;
  contentType: string;
  /** Raw payload — kept small (≤ few MB) since we buffer in memory. */
  bytes: Buffer;
}

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plaintext body — templates in `notification/domain/templates.ts` are all short-form. */
  body: string;
  attachments?: readonly EmailAttachment[];
}

export interface EmailAdapter {
  /**
   * Fire-and-forget send. Implementations are responsible for catching
   * transport errors and logging them; they MUST NOT throw, so a broken
   * SMTP host cannot roll back a business transaction that already
   * committed to the DB.
   */
  send(message: EmailMessage): Promise<void>;

  /** Human-readable transport name for boot-time diagnostics. */
  readonly transport: string;
}

export const EMAIL_ADAPTER = Symbol('EMAIL_ADAPTER');
