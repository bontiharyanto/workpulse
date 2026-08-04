import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PrivacyPolicyDto {
  @ApiProperty() id!: string;
  @ApiProperty() companyId!: string;
  @ApiProperty() version!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty() effectiveAt!: string;
  @ApiProperty({ nullable: true }) publishedById!: string | null;
  @ApiProperty() createdAt!: string;
}

export class PrivacyPolicyListResponseDto {
  @ApiProperty({ type: [PrivacyPolicyDto] })
  items!: PrivacyPolicyDto[];
}

export class PublishPolicyDto {
  @ApiProperty({
    description:
      'Human-readable version label. Unique per tenant — publishing the same version twice returns 409.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  version!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({
    description:
      'Markdown-ish body. HTML tags are neither sanitised nor accepted — the FE renders as plain text with paragraph breaks.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  body!: string;

  @ApiProperty({
    required: false,
    description:
      'Optional future effective date (ISO 8601). Defaults to now. Users see the policy only once `NOW() >= effectiveAt`.',
  })
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;
}

export class AcceptConsentDto {
  @ApiProperty()
  @IsString()
  policyId!: string;
}

export class UserConsentDto {
  @ApiProperty() id!: string;
  @ApiProperty() policyId!: string;
  @ApiProperty() policyVersion!: string;
  @ApiProperty() policyTitle!: string;
  @ApiProperty() acceptedAt!: string;
  @ApiProperty({ nullable: true }) ip!: string | null;
  @ApiProperty({ nullable: true }) userAgent!: string | null;
}

export class UserConsentListResponseDto {
  @ApiProperty({ type: [UserConsentDto] }) items!: UserConsentDto[];
}
