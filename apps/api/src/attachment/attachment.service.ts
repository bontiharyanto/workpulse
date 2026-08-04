import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import type { StorageProvider } from '../storage/storage.provider';
import { STORAGE_PROVIDER } from '../storage/storage.provider';

import type { AttachmentPurpose } from './domain/attachment-key';
import { buildAttachmentKey } from './domain/attachment-key';
import {
  MAX_UPLOAD_BYTES,
  extensionForContentType,
  isAllowedContentType,
} from './domain/content-type';
import type { PresignPutResponseDto } from './dto/presign.dto';

export interface PresignPutInput {
  purpose: AttachmentPurpose;
  contentType: string;
  sizeBytes: number;
}

@Injectable()
export class AttachmentService {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  async presignPut(
    actor: AuthenticatedUser,
    input: PresignPutInput,
  ): Promise<PresignPutResponseDto> {
    if (!this.storage.enabled) {
      throw new ServiceUnavailableException('STORAGE_NOT_CONFIGURED');
    }
    if (!isAllowedContentType(input.contentType)) {
      throw new BadRequestException('CONTENT_TYPE_NOT_ALLOWED');
    }
    if (input.sizeBytes <= 0 || input.sizeBytes > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('FILE_TOO_LARGE');
    }

    const fileKey = buildAttachmentKey({
      purpose: input.purpose,
      companyId: actor.companyId,
      userId: actor.id,
      extension: extensionForContentType(input.contentType),
      uuid: randomUUID(),
      now: new Date(),
    });

    const signed = await this.storage.presignPut({
      key: fileKey,
      contentType: input.contentType,
      contentLength: input.sizeBytes,
    });

    return {
      uploadUrl: signed.uploadUrl,
      fileKey,
      requiredHeaders: signed.requiredHeaders,
      expiresIn: signed.expiresIn,
    };
  }

  /**
   * Presign a short-lived GET URL for a given key. Caller is responsible for
   * authorizing that the requesting user should see this attachment (e.g.
   * owner, their supervisor, or HR).
   */
  async presignGet(
    key: string,
    downloadFilename?: string,
  ): Promise<{ url: string; expiresIn: number }> {
    if (!this.storage.enabled) {
      throw new ServiceUnavailableException('STORAGE_NOT_CONFIGURED');
    }
    return this.storage.presignGet({ key, downloadFilename });
  }
}
