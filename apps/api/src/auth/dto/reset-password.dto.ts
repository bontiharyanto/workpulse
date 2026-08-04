import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    description:
      'Opaque base64url-encoded reset token from the email link. NEVER logged server-side.',
  })
  @IsString()
  @MinLength(40)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'Token tidak valid' })
  token!: string;

  @ApiProperty({ minLength: 8, example: 'NewStrongPassword123!' })
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password!: string;
}
