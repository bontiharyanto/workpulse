import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared MFA Zod schemas — mirror the API DTOs in
// `apps/api/src/auth/mfa/dto/mfa.dto.ts`. Kept in this package so the
// FE and (potentially) other clients can validate at the boundary
// without importing the NestJS DTOs.
// ---------------------------------------------------------------------------

const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, { message: 'Kode MFA harus 6 digit angka' });

const backupCodeSchema = z
  .string()
  .trim()
  .min(6, { message: 'Backup code minimal 6 karakter' })
  .max(40);

/**
 * Treat empty strings as "not provided" for optional fields. React
 * Hook Form initialises text inputs with `''`, but Zod's `.optional()`
 * only recognises `undefined` — so a value like `{ code: '000000',
 * backupCode: '' }` would trip `backupCode.min(6)` even though the
 * user never touched the field. Preprocessing `''` → `undefined`
 * keeps the schema honest on the API side while allowing the RHF
 * default to sail through validation on the FE.
 */
const blankAsUndefined = (input: unknown): unknown =>
  typeof input === 'string' && input.trim() === '' ? undefined : input;

/** POST /auth/mfa/enroll/confirm request body. */
export const mfaEnrollConfirmInputSchema = z.object({
  code: totpCodeSchema,
});
export type MfaEnrollConfirmInput = z.infer<typeof mfaEnrollConfirmInputSchema>;

/** POST /auth/mfa/enroll/start response body. */
export const mfaEnrollStartResponseSchema = z.object({
  otpauthUrl: z.string(),
  qrCodeDataUri: z.string(),
  secret: z.string(),
});
export type MfaEnrollStartResponse = z.infer<typeof mfaEnrollStartResponseSchema>;

/** POST /auth/mfa/enroll/confirm response body. */
export const mfaEnrollConfirmResponseSchema = z.object({
  backupCodes: z.array(z.string()),
  accessToken: z.string(),
  accessTokenExpiresIn: z.number().int().positive(),
});
export type MfaEnrollConfirmResponse = z.infer<typeof mfaEnrollConfirmResponseSchema>;

/**
 * POST /auth/mfa/verify request body. Exactly one of `code` / `backupCode`
 * must be present. The refine keeps the Zod error attached to the
 * form-level (not a specific field) so the FE can show a single
 * "kode wajib diisi" message next to the input.
 */
export const mfaVerifyInputSchema = z
  .object({
    code: z.preprocess(blankAsUndefined, totpCodeSchema.optional()),
    backupCode: z.preprocess(blankAsUndefined, backupCodeSchema.optional()),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.backupCode), {
    message: 'Isi salah satu: kode TOTP ATAU backup code',
  });
export type MfaVerifyInput = z.infer<typeof mfaVerifyInputSchema>;

export const mfaVerifyResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresIn: z.number().int().positive(),
  usedBackupCode: z.boolean(),
});
export type MfaVerifyResponse = z.infer<typeof mfaVerifyResponseSchema>;

/** POST /auth/mfa/backup-codes/regenerate request body. */
export const mfaBackupCodesInputSchema = z.object({
  code: totpCodeSchema,
});
export type MfaBackupCodesInput = z.infer<typeof mfaBackupCodesInputSchema>;

export const mfaBackupCodesResponseSchema = z.object({
  backupCodes: z.array(z.string()),
});
export type MfaBackupCodesResponse = z.infer<typeof mfaBackupCodesResponseSchema>;

/** DELETE /auth/mfa request body. Requires password + current TOTP. */
export const mfaDisableInputSchema = z.object({
  currentPassword: z.string().min(8, { message: 'Password minimal 8 karakter' }).max(128),
  code: totpCodeSchema,
});
export type MfaDisableInput = z.infer<typeof mfaDisableInputSchema>;

export const mfaStatusSchema = z.object({
  enabled: z.boolean(),
  enabledAt: z.string().nullable(),
  remainingBackupCodes: z.number().int().nonnegative(),
});
export type MfaStatus = z.infer<typeof mfaStatusSchema>;
