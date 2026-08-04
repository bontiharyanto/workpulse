import { IsIn, IsInt, IsString, Length, Max, Min } from 'class-validator';

import { MAX_UPLOAD_BYTES } from '../domain/content-type';

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
const PURPOSES = ['leave-attachment', 'attendance-correction'] as const;

export class PresignPutRequestDto {
  @IsIn(PURPOSES)
  purpose!: (typeof PURPOSES)[number];

  @IsIn(ALLOWED_MIMES)
  contentType!: (typeof ALLOWED_MIMES)[number];

  @IsInt()
  @Min(1)
  @Max(MAX_UPLOAD_BYTES)
  sizeBytes!: number;

  /** Cosmetic — will NOT be used as-is; server derives the actual key from a UUID. */
  @IsString()
  @Length(1, 200)
  filename!: string;
}

export interface PresignPutResponseDto {
  uploadUrl: string;
  fileKey: string;
  requiredHeaders: Record<string, string>;
  expiresIn: number;
}
