import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * `POST /admin/companies` — SUPER_ADMIN creates a new tenant.
 *
 * The initial HR user is created in the same transaction so the new tenant
 * is immediately usable. The temp password is generated server-side and
 * returned ONCE in the response — never persisted plaintext.
 */
export class CreateCompanyDto {
  @ApiProperty({ example: 'Acme Corporation' })
  @IsString()
  @Length(2, 120)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @ApiPropertyOptional({
    description:
      'URL-safe short identifier for the tenant. When omitted, the API derives it from `name`. Must match /^[a-z0-9-]+$/.',
    example: 'acme',
  })
  @IsOptional()
  @IsString()
  @Length(2, 40)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must contain only lowercase letters, digits, and hyphens',
  })
  slug?: string;

  @ApiPropertyOptional({
    example: 'Asia/Jakarta',
    description: 'IANA timezone name. Defaults to Asia/Jakarta.',
  })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({
    example: 'hr@acme.com',
    description:
      'Email of the initial HR user. Receives a one-time temp password + `mustChangePassword=true`.',
  })
  @IsEmail()
  hrEmail!: string;

  @ApiProperty({ example: 'Sarah HR', description: 'Full name of the initial HR user.' })
  @IsString()
  @Length(2, 120)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  hrFullName!: string;
}
