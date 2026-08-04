import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * Six-digit TOTP code as displayed by the authenticator app. We accept
 * only [0-9]{6} so garbage input is rejected before the crypto layer.
 * Note: backup codes are handled by `MfaBackupCodeDto` since their
 * length + alphabet differ.
 */
export class MfaTotpCodeDto {
  @ApiProperty({ description: '6-digit TOTP code' })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;
}

/**
 * Backup code: normalized shape `ABCDEFGH12` (10 chars from the fixed
 * alphabet). We accept a looser input (users may write dashes / spaces
 * when transcribing) and normalize in the service.
 */
export class MfaBackupCodeDto {
  @ApiProperty({ description: 'One-time backup code' })
  @IsString()
  @Length(6, 40)
  code!: string;
}

/**
 * Union payload for `POST /auth/mfa/verify`. Exactly one of `code`
 * (TOTP) or `backupCode` must be supplied. The service validates
 * exclusivity so we don't silently accept both.
 */
export class MfaVerifyDto {
  @ApiProperty({ required: false, description: '6-digit TOTP code' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code?: string;

  @ApiProperty({ required: false, description: 'One-time backup code' })
  @IsOptional()
  @IsString()
  @Length(6, 40)
  backupCode?: string;
}

/**
 * DELETE `/auth/mfa` requires proof of both factors: current password
 * AND a current TOTP code. This is a defensive redundancy — an
 * attacker with a live session shouldn't be able to shed MFA using
 * only the session cookie.
 */
export class MfaDisableDto {
  @ApiProperty()
  @IsString()
  @Length(8, 128)
  currentPassword!: string;

  @ApiProperty({ description: '6-digit TOTP code' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;
}

export class MfaEnrollStartResponseDto {
  @ApiProperty({ description: 'otpauth:// URL for the authenticator app to consume via QR code' })
  otpauthUrl!: string;
  @ApiProperty({ description: 'Base64 data URI PNG of the QR code (rendered server-side)' })
  qrCodeDataUri!: string;
  @ApiProperty({ description: 'Human-readable base32 secret — a fallback when QR scanning is unavailable' })
  secret!: string;
}

export class MfaEnrollConfirmResponseDto {
  @ApiProperty({
    description:
      'One-time list of backup codes. Shown ONCE, never returned again. FE must present a confirmation checkbox and offer print/download.',
    type: [String],
  })
  backupCodes!: string[];

  @ApiProperty({ description: 'Fresh access token with `mfaEnabled=true` claim baked in' })
  accessToken!: string;
  @ApiProperty({ description: 'Access token lifetime in seconds' })
  accessTokenExpiresIn!: number;
}

export class MfaBackupCodesResponseDto {
  @ApiProperty({ description: 'Fresh batch of backup codes; prior codes are invalidated', type: [String] })
  backupCodes!: string[];
}

export class MfaStatusDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ nullable: true, description: 'ISO timestamp when the second factor was activated' })
  enabledAt!: string | null;
  @ApiProperty({ description: 'Number of unused backup codes remaining' })
  remainingBackupCodes!: number;
}

export class MfaVerifyResponseDto {
  @ApiProperty({ description: 'Fresh access token with `mfaPassed=true` claim baked in' })
  accessToken!: string;
  @ApiProperty({ description: 'Access token lifetime in seconds' })
  accessTokenExpiresIn!: number;
  @ApiProperty({ description: 'Whether the caller used a backup code (informational — always false for TOTP)' })
  usedBackupCode!: boolean;
}
