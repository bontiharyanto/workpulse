import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import { AttachmentService } from './attachment.service';
import { PresignPutRequestDto, type PresignPutResponseDto } from './dto/presign.dto';

@ApiTags('attachments')
@Controller('attachments')
// Presign is cheap for us but generates S3 signing overhead + can be abused by a
// compromised session to flood the bucket with orphaned URLs. Cap at 30 / min
// per user — enough for interactive UX, tight enough to slow enumeration.
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AttachmentController {
  constructor(private readonly service: AttachmentService) {}

  @Post('presign')
  @HttpCode(HttpStatus.OK)
  presign(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: PresignPutRequestDto,
  ): Promise<PresignPutResponseDto> {
    return this.service.presignPut(actor, {
      purpose: body.purpose,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
    });
  }
}
