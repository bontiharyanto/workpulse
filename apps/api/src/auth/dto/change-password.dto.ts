import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Payload for `POST /auth/change-password`. Requires the caller to
 * re-authenticate with their `currentPassword` so a leaked access token
 * alone cannot silently rotate the credential.
 */
export class ChangePasswordDto {
  @ApiProperty({
    description:
      'The password currently on file. Verified via argon2 before the new password is accepted.',
    minLength: 1,
    maxLength: 256,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword!: string;

  @ApiProperty({
    description:
      'New password. Must be at least 8 characters. The server does NOT enforce a complexity rule beyond length — front-end guidance carries UX, argon2 carries the security.',
    minLength: 8,
    maxLength: 256,
    example: 'S3lfPickedPassphrase!',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  newPassword!: string;
}
