/**
 * Storage abstraction. Two implementations planned:
 *   - `S3StorageProvider` — production (AWS) + local dev (MinIO).
 *   - future `LocalStorageProvider` — smoke tests without S3/MinIO.
 *
 * All ops are async and take opaque object **keys** (never full URLs) so the
 * caller cannot leak bucket / endpoint details across layers.
 */

export interface PresignPutInput {
  key: string;
  contentType: string;
  /** Enforced by S3 via signed `Content-Length` header — MUST match on PUT. */
  contentLength: number;
}

export interface PresignPutResult {
  uploadUrl: string;
  /** Headers the client MUST send verbatim on the PUT (Content-Type + Content-Length). */
  requiredHeaders: Record<string, string>;
  expiresIn: number;
}

export interface PresignGetInput {
  key: string;
  /** If provided, forces a friendly filename on download (`Content-Disposition`). */
  downloadFilename?: string;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

/**
 * Server-side upload. Used by workflows that generate a payload
 * inside the API (e.g. DSAR export ZIPs) rather than accepting a
 * client-provided attachment through a presigned URL.
 */
export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array | NodeJS.ReadableStream;
  contentType: string;
  contentLength?: number;
}

export interface StorageProvider {
  presignPut(input: PresignPutInput): Promise<PresignPutResult>;
  presignGet(input: PresignGetInput): Promise<{ url: string; expiresIn: number }>;
  /**
   * Upload an object directly from the server. Used for DSAR export
   * archives that we assemble in-process — no client involvement.
   */
  putObject(input: PutObjectInput): Promise<void>;
  /**
   * Best-effort delete. Implementations MUST swallow "not found" so
   * retention sweeps are idempotent.
   */
  deleteObject(key: string): Promise<void>;
  /**
   * Cheap probe used by `/api/v1/health/deep`. Should succeed if the
   * bucket is reachable, credentials are valid, and network is up.
   * Timeout MUST be bounded (recommendation: 3s) so a stuck check does
   * not stall the health endpoint.
   *
   * Return `{ ok: true }` on success. On failure, EITHER throw OR
   * return `{ ok: false, reason }`. Implementations MUST NOT hang.
   */
  healthCheck(): Promise<
    { ok: true; latencyMs: number } | { ok: false; reason: string; latencyMs: number }
  >;
  /** True when storage is configured and reachable enough to attempt a call. */
  readonly enabled: boolean;
}
