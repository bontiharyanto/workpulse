import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvConfig } from '../config/env.validation';

import type {
  PresignGetInput,
  PresignPutInput,
  PresignPutResult,
  PutObjectInput,
  StorageProvider,
} from './storage.provider';

@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly logger = new Logger(S3StorageProvider.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly putTtl: number;
  private readonly getTtl: number;
  readonly enabled: boolean;

  constructor(@Inject(ConfigService) config: ConfigService<EnvConfig, true>) {
    const bucket = config.get('S3_BUCKET', { infer: true });
    const accessKeyId = config.get('S3_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY', { infer: true });

    if (!bucket || !accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'S3 storage disabled — set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY to enable attachments.',
      );
      this.enabled = false;
      // Init a dummy client to satisfy the readonly field — never called when `enabled=false`.
      this.client = new S3Client({ region: 'us-east-1' });
      this.bucket = '';
      this.putTtl = 300;
      this.getTtl = 3600;
      return;
    }

    this.enabled = true;
    this.bucket = bucket;
    this.putTtl = config.get('S3_PRESIGN_PUT_TTL_SECONDS', { infer: true });
    this.getTtl = config.get('S3_PRESIGN_GET_TTL_SECONDS', { infer: true });

    this.client = new S3Client({
      region: config.get('S3_REGION', { infer: true }),
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async presignPut(input: PresignPutInput): Promise<PresignPutResult> {
    this.assertEnabled();
    // Bind Content-Type + Content-Length into the signature so the client can't
    // upload a different mimetype or oversized payload than what the backend authorized.
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    });
    const uploadUrl = await getSignedUrl(this.client, cmd, {
      expiresIn: this.putTtl,
      // Signed request will only match if the client sends these headers unchanged.
      signableHeaders: new Set(['content-type', 'content-length']),
    });

    return {
      uploadUrl,
      requiredHeaders: {
        'Content-Type': input.contentType,
        'Content-Length': String(input.contentLength),
      },
      expiresIn: this.putTtl,
    };
  }

  async presignGet(
    input: PresignGetInput,
  ): Promise<{ url: string; expiresIn: number }> {
    this.assertEnabled();
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ResponseContentDisposition: input.downloadFilename
        ? `attachment; filename="${sanitizeFilename(input.downloadFilename)}"`
        : undefined,
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: this.getTtl });
    return { url, expiresIn: this.getTtl };
  }

  async putObject(input: PutObjectInput): Promise<void> {
    this.assertEnabled();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body as PutObjectCommand['input']['Body'],
        ContentType: input.contentType,
        ContentLength: input.contentLength,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    this.assertEnabled();
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (err) {
      // Idempotency: absent objects raise `NoSuchKey`; a retention
      // sweep re-running on an already-deleted export MUST NOT throw.
      if (err instanceof S3ServiceException && err.name === 'NoSuchKey') {
        return;
      }
      throw err;
    }
  }

  async healthCheck(): Promise<
    { ok: true; latencyMs: number } | { ok: false; reason: string; latencyMs: number }
  > {
    if (!this.enabled) {
      return { ok: false, reason: 'storage_disabled', latencyMs: 0 };
    }
    const started = Date.now();
    try {
      // AbortController gives us a hard timeout — the AWS SDK's own timeouts
      // are per-attempt, so retries can accumulate well past 3s otherwise.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        await this.client.send(
          new HeadBucketCommand({ Bucket: this.bucket }),
          { abortSignal: controller.signal },
        );
        return { ok: true, latencyMs: Date.now() - started };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const reason =
        err instanceof S3ServiceException
          ? `${err.name}:${err.$metadata?.httpStatusCode ?? 'nostatus'}`
          : (err as Error)?.name || 'unknown';
      return { ok: false, reason, latencyMs: Date.now() - started };
    }
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new Error('S3_STORAGE_NOT_CONFIGURED');
    }
  }
}

function sanitizeFilename(name: string): string {
  // Strip quotes + CR/LF that could smuggle a header injection through
  // `Content-Disposition`. Whitelist ASCII printable + common accents.
  return name.replace(/["\r\n\\]/g, '').slice(0, 200);
}
