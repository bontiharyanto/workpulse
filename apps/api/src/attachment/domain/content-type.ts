/**
 * Whitelist of MIME types allowed for user uploads. Anything not on this list
 * is rejected server-side BEFORE we sign a URL — so an attacker with a stolen
 * session cannot store arbitrary executables in our bucket.
 */

export const ALLOWED_CONTENT_TYPES = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);

export type AllowedContentType = string;

/** 5 MiB — chosen as a sensible cap for a medical/permit document. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function isAllowedContentType(mime: string): mime is AllowedContentType {
  return ALLOWED_CONTENT_TYPES.has(mime);
}

/**
 * Extension that MUST be used for the given MIME type. We prefer this over the
 * user-supplied filename to avoid `.exe` disguised as `.pdf` etc.
 */
export function extensionForContentType(mime: string): string {
  const ext = ALLOWED_CONTENT_TYPES.get(mime);
  if (!ext) {
    throw new RangeError(`unsupported content-type: ${mime}`);
  }
  return ext;
}
