import { ApiProperty } from '@nestjs/swagger';

/**
 * Wire shape for one DSAR request. Mirrors
 * `packages/shared-types/src/data-export.ts` so the FE can decode
 * the raw fetch response without transformation.
 *
 * `downloadUrl` is deliberately **not** persisted anywhere — we mint
 * a short-lived presigned GET whenever the caller lists their requests
 * and the row is `READY`. That keeps the URL fresh (15 min TTL) and
 * avoids stale-cookie style leaks where an old URL is still valid.
 */
export class DataExportRequestDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['PENDING', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED'] })
  status!: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'EXPIRED';

  @ApiProperty()
  requestedAt!: string;

  @ApiProperty({ nullable: true })
  completedAt!: string | null;

  @ApiProperty({ nullable: true })
  failedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'When `status=FAILED`. Human-readable, safe to render. Never leaks stack traces.',
  })
  failureReason!: string | null;

  @ApiProperty({ nullable: true, description: 'Bytes; only set when READY.' })
  fileSize!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      '24h from `completedAt`. After this point the S3 object is deleted and the row flips to EXPIRED.',
  })
  expiresAt!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Short-lived presigned S3 URL. Only set when `status=READY` AND the caller asked for a fresh URL via the download endpoint. On list endpoints this stays `null`; the FE calls the download route to mint one.',
  })
  downloadUrl!: string | null;
}

export class DataExportListResponseDto {
  @ApiProperty({ type: [DataExportRequestDto] })
  requests!: DataExportRequestDto[];
}

export class DataExportDownloadResponseDto {
  @ApiProperty({
    description:
      'Presigned S3 GET URL. TTL is fixed by `S3_PRESIGN_GET_TTL_SECONDS`. Redirect the browser to this URL immediately — do not persist it.',
  })
  downloadUrl!: string;

  @ApiProperty({ description: 'Seconds until the presigned URL expires.' })
  expiresIn!: number;
}
