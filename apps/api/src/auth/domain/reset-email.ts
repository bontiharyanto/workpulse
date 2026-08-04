/**
 * Builds the "click this to reset" email that carries the raw reset
 * token. Kept separate from the `Notification` system because:
 *
 * 1. **No DB row.** The link should not live anywhere it could be
 *    later read — DB backups, sysadmin browsing the notifications
 *    table, screen-share to support. Once emitted it exists only in
 *    the user's inbox.
 * 2. **No login required.** The user is locked out; there is no
 *    in-app UI to deliver this to.
 * 3. **Deterministic recipient.** Whereas `NotificationService`
 *    joins on the recipient's active state, we send this to the raw
 *    email address regardless of whether we found the user, so an
 *    attacker can't infer account existence from send/no-send
 *    behaviour (we actually only send when the user exists, but the
 *    controller path is uniform — see PasswordResetService.request).
 */
export interface ResetLinkEmailContent {
  to: string;
  subject: string;
  body: string;
}

export interface BuildResetLinkEmailInput {
  toEmail: string;
  displayName: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export function buildResetLinkEmail(
  input: BuildResetLinkEmailInput,
): ResetLinkEmailContent {
  const { toEmail, displayName, resetUrl, expiresInMinutes } = input;
  const greetingName = displayName.trim() || 'Rekan Workpulse';
  const body = [
    `Halo ${greetingName},`,
    '',
    `Anda menerima email ini karena ada permintaan reset password untuk akun ${toEmail} di Workpulse.`,
    '',
    `Klik atau salin link berikut untuk memilih password baru (berlaku ${expiresInMinutes} menit):`,
    resetUrl,
    '',
    'Jika Anda tidak meminta reset ini, abaikan email ini — password Anda tidak akan berubah.',
    '',
    '— Tim Workpulse',
  ].join('\n');
  return {
    to: toEmail,
    subject: 'Reset password Workpulse',
    body,
  };
}
