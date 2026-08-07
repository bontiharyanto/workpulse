import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { RangeResponse, Source } from 'pmtiles';

/**
 * PMTiles `Source` adapter that pulls byte ranges from S3 / MinIO.
 *
 * # Why not just download the archive at boot?
 *
 * A Protomaps Indonesia extract is ~450 MB — pinning it in the API
 * process's heap crosses several NestJS deploy sizing thresholds.
 * PMTiles is designed for HTTP byte-range access; MinIO honours
 * `Range: bytes=<off>-<off+len-1>` cleanly, so this Source pattern
 * matches the archive format's original intent.
 *
 * # etag / cache
 *
 * PMTiles calls `getBytes` many times per tile (once for the header,
 * once for the root directory, then once per leaf directory and once
 * for the tile blob). The pmtiles client caches internally on
 * `etag`. We return MinIO's ETag verbatim so the internal cache is
 * effective across tiles that share directory pages.
 *
 * # Testability
 *
 * The `S3Client` is injected so tests can pass a mock without spinning
 * up a real MinIO. See `s3-pmtiles-source.spec.ts` for the contract
 * this class must honour.
 */
export class S3PMTilesSource implements Source {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly key: string,
  ) {}

  /**
   * Return an opaque identifier PMTiles uses for cache keys. Using
   * the S3 key keeps two archives (say, `indonesia.pmtiles` and
   * `japan.pmtiles`) from colliding in a shared cache.
   */
  getKey(): string {
    return `s3://${this.bucket}/${this.key}`;
  }

  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    // MinIO / S3 range syntax is inclusive on both ends.
    const range = `bytes=${offset}-${offset + length - 1}`;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.key,
      Range: range,
      // Passing IfMatch when the caller supplied an etag lets us
      // detect the "someone swapped the archive under us" case: MinIO
      // returns 412 and pmtiles knows to invalidate its directory
      // cache and start over.
      ...(etag ? { IfMatch: etag } : {}),
    });
    const response = await this.client.send(command, { abortSignal: signal });

    // The AWS SDK's Body is a Node stream; convert to ArrayBuffer.
    const body = response.Body;
    if (!body) {
      throw new Error('S3_EMPTY_BODY');
    }
    const arrayBuffer = await streamToArrayBuffer(body);

    return {
      data: arrayBuffer,
      etag: response.ETag,
      // Passing MinIO's cache-control back to pmtiles lets it honour
      // any TTL the ops team sets on the object.
      cacheControl: response.CacheControl,
      expires: response.Expires ? response.Expires.toUTCString() : undefined,
    };
  }
}

async function streamToArrayBuffer(body: unknown): Promise<ArrayBuffer> {
  // AWS SDK v3 Body can be:
  //   * Node.js Readable stream (server-side runs this branch)
  //   * Web ReadableStream (edge runtime — not applicable here)
  //   * Blob (browser — not applicable)
  //
  // We only need the Node path. Falling back to the `transformToByteArray`
  // helper the SDK ships would work too, but implementing directly
  // makes this trivially unit-testable with a stub stream.
  //
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = body as any;
  if (typeof stream?.transformToByteArray === 'function') {
    const bytes = (await stream.transformToByteArray()) as Uint8Array;
    // Slice to a fresh ArrayBuffer so PMTiles' cache doesn't retain
    // a reference into a large shared buffer.
    return copyToArrayBuffer(bytes);
  }
  const chunks: Buffer[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const chunk of stream as AsyncIterable<any>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return copyToArrayBuffer(Buffer.concat(chunks));
}

/**
 * Copies a view of bytes into a fresh, standalone `ArrayBuffer`. The
 * SDK's `Uint8Array.buffer` type may widen to `ArrayBufferLike` /
 * `SharedArrayBuffer` under strict TS, and PMTiles specifically
 * expects a plain `ArrayBuffer`. A `Uint8Array.set()` into a new
 * buffer is both correct and cheap.
 */
function copyToArrayBuffer(bytes: Uint8Array | Buffer): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}
