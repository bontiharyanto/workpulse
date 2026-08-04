/**
 * S3 object keys for user uploads. Structure:
 *
 *   attachments/{purpose}/{companyId}/{userId}/{yyyy}/{mm}/{uuid}.{ext}
 *
 * Rationale:
 *   - `purpose` scopes deletion / retention policies (leave-attachment vs. avatar etc.).
 *   - `{companyId}/{userId}` prefix lets us verify ownership by string comparison
 *     without querying the DB — the caller who received a key on presign is the
 *     same principal that can later reference it.
 *   - `{yyyy}/{mm}` cost-optimizes S3 lifecycle rules (archive attachments older
 *     than N months into Glacier).
 *   - UUID as filename removes any user-controllable component from the object
 *     path — prevents key-collision attacks and enumeration.
 */

export type AttachmentPurpose = 'leave-attachment' | 'attendance-correction';

export interface BuildKeyInput {
  purpose: AttachmentPurpose;
  companyId: string;
  userId: string;
  extension: string;
  uuid: string;
  /** ISO instant used only to compute yyyy/mm — pure w.r.t. input. */
  now: Date;
}

export function buildAttachmentKey(input: BuildKeyInput): string {
  assertNoSlash(input.companyId, 'companyId');
  assertNoSlash(input.userId, 'userId');
  assertUuid(input.uuid);
  assertExtension(input.extension);
  const yyyy = String(input.now.getUTCFullYear());
  const mm = String(input.now.getUTCMonth() + 1).padStart(2, '0');
  return `attachments/${input.purpose}/${input.companyId}/${input.userId}/${yyyy}/${mm}/${input.uuid}.${input.extension}`;
}

/**
 * Verify the given key is a valid attachment key AND that its owner prefix
 * matches the given (companyId, userId). Any deviation → false.
 *
 * Used when the client submits a leave request with `attachmentKey`: we MUST
 * ensure the key was minted for **this** user, not stolen from another user's
 * session.
 */
export function isOwnedAttachmentKey(
  key: string,
  companyId: string,
  userId: string,
  purpose: AttachmentPurpose = 'leave-attachment',
): boolean {
  const prefix = `attachments/${purpose}/${companyId}/${userId}/`;
  if (!key.startsWith(prefix)) return false;
  // Reject traversal / whitespace shenanigans anywhere in the key.
  if (/\.\.|\s/u.test(key)) return false;
  // Basic shape check: attachments/<purpose>/<company>/<user>/<yyyy>/<mm>/<uuid>.<ext>
  const pattern = new RegExp(
    `^attachments\\/${purpose}\\/[^/]+\\/[^/]+\\/\\d{4}\\/\\d{2}\\/[0-9a-f-]{36}\\.[a-z0-9]{2,5}$`,
    'u',
  );
  return pattern.test(key);
}

function assertNoSlash(v: string, field: string): void {
  if (v.length === 0 || v.includes('/')) {
    throw new RangeError(`invalid ${field}: ${v}`);
  }
}

function assertUuid(v: string): void {
  if (!/^[0-9a-f-]{36}$/u.test(v)) {
    throw new RangeError(`invalid uuid: ${v}`);
  }
}

function assertExtension(v: string): void {
  if (!/^[a-z0-9]{2,5}$/u.test(v)) {
    throw new RangeError(`invalid extension: ${v}`);
  }
}
