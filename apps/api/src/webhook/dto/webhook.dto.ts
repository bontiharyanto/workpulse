import { ApiProperty } from '@nestjs/swagger';
import { WebhookEventType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

/**
 * Fase 32e — HTTP surface for webhook admin endpoints. Body payloads
 * for outbound HTTP itself are typed in `webhook-dispatcher.service`
 * (they never leave the API as DTOs; vendors receive JSON).
 */

export class CreateWebhookDto {
  @ApiProperty({ description: 'Absolute HTTPS URL (in production).' })
  @IsUrl({ require_tld: false, require_protocol: true }, { message: 'URL invalid' })
  @MaxLength(1024)
  url!: string;

  @ApiProperty({ required: false, nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string | null;

  @ApiProperty({
    isArray: true,
    enum: WebhookEventType,
    description: 'One or more events to subscribe to.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(WebhookEventType, { each: true })
  events!: WebhookEventType[];
}

export class UpdateWebhookDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  @MaxLength(1024)
  url?: string;

  @ApiProperty({ required: false, nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string | null;

  @ApiProperty({ required: false, isArray: true, enum: WebhookEventType })
  @IsOptional()
  @IsArray()
  @IsEnum(WebhookEventType, { each: true })
  events?: WebhookEventType[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class WebhookEndpointRowDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ enum: WebhookEventType, isArray: true })
  events!: WebhookEventType[];

  @ApiProperty()
  active!: boolean;

  @ApiProperty()
  consecutiveFailures!: number;

  @ApiProperty({ nullable: true })
  lastSuccessAt!: string | null;

  @ApiProperty({ nullable: true })
  lastFailureAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty()
  createdBy!: { id: string; fullName: string; email: string };
}

export class WebhookEndpointWithSecretDto extends WebhookEndpointRowDto {
  @ApiProperty({
    description:
      'Plaintext HMAC secret. Only returned once at create + on rotate. Store this in the vendor system NOW — it cannot be retrieved later.',
  })
  secret!: string;
}

export class WebhookEndpointListDto {
  @ApiProperty({ type: [WebhookEndpointRowDto] })
  @Type(() => WebhookEndpointRowDto)
  items!: WebhookEndpointRowDto[];
}

export class WebhookDeliveryRowDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  endpointId!: string;

  @ApiProperty({ enum: WebhookEventType })
  eventType!: WebhookEventType;

  @ApiProperty()
  sourceId!: string;

  @ApiProperty()
  status!: 'PENDING' | 'SUCCEEDED' | 'FAILED';

  @ApiProperty()
  attemptCount!: number;

  @ApiProperty()
  nextAttemptAt!: string;

  @ApiProperty({ nullable: true })
  lastAttemptAt!: string | null;

  @ApiProperty({ nullable: true })
  lastResponseStatus!: number | null;

  @ApiProperty({ nullable: true })
  lastError!: string | null;

  @ApiProperty({ nullable: true })
  deliveredAt!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class WebhookDeliveryListDto {
  @ApiProperty({ type: [WebhookDeliveryRowDto] })
  @Type(() => WebhookDeliveryRowDto)
  items!: WebhookDeliveryRowDto[];
}
