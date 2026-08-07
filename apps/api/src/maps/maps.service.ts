import {
  GetObjectCommand,
  NoSuchKey,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EtagMismatch, PMTiles } from 'pmtiles';

import { S3PMTilesSource } from './domain/s3-pmtiles-source';

import type { EnvConfig } from '../config/env.validation';

/**
 * MapsService — read-through cache in front of the MinIO
 * `MAPS_TILES_BUCKET`. See ADR-0042 §Backend for the request /
 * response contract.
 *
 * # Lifecycle
 *
 * The `S3Client` and `PMTiles` handle are instantiated eagerly and
 * kept alive for the process. PMTiles caches directory pages in
 * memory (bounded, ~5 MB), so per-tile requests hit only one S3
 * range read on average once the tree is warm.
 *
 * # Failure modes
 *
 * - `MAPS_ENABLED=false` → every entry point throws
 *   `MAPS_DISABLED` (503). Used during Phase 1 of the rollout so
 *   the FE degrades gracefully to a "map unavailable" placeholder.
 * - PMTiles archive missing from bucket → 404 `MAPS_ARCHIVE_MISSING`
 *   with a hint that ops needs to run the bootstrap runbook.
 * - Any other S3 error → 503 `MAPS_UPSTREAM_UNAVAILABLE` so the FE
 *   can retry without spooking the user with a 500.
 */
@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);
  private readonly enabled: boolean;
  private readonly bucket: string;
  private readonly pmtilesKey: string;
  private readonly glyphsPrefix: string;
  private readonly spritesPrefix: string;
  private readonly client: S3Client | null;
  private readonly pmtiles: PMTiles | null;

  constructor(@Inject(ConfigService) config: ConfigService<EnvConfig, true>) {
    this.enabled = config.get('MAPS_ENABLED', { infer: true }) === 'true';
    this.bucket = config.get('MAPS_TILES_BUCKET', { infer: true });
    this.pmtilesKey = config.get('MAPS_PMTILES_KEY', { infer: true });
    this.glyphsPrefix = config.get('MAPS_GLYPHS_PREFIX', { infer: true });
    this.spritesPrefix = config.get('MAPS_SPRITES_PREFIX', { infer: true });

    if (!this.enabled) {
      this.logger.warn(
        'MapsService disabled (MAPS_ENABLED=false). `/maps/*` endpoints will return 503.',
      );
      this.client = null;
      this.pmtiles = null;
      return;
    }

    const accessKeyId = config.get('S3_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY', { infer: true });
    if (!accessKeyId || !secretAccessKey) {
      // Boot with the feature declared "enabled" but the S3
      // credentials missing is an operator misconfiguration — fail
      // loudly rather than confusingly at first tile request.
      throw new Error(
        'MAPS_ENABLED=true but S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are missing. Configure both.',
      );
    }

    this.client = new S3Client({
      region: config.get('S3_REGION', { infer: true }),
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: { accessKeyId, secretAccessKey },
    });
    this.pmtiles = new PMTiles(new S3PMTilesSource(this.client, this.bucket, this.pmtilesKey));
  }

  /**
   * Returns MVT bytes for one tile, gzip-compressed as stored inside
   * the archive. Callers MUST forward `Content-Encoding: gzip` and
   * `Content-Type: application/vnd.mapbox-vector-tile` to the client.
   *
   * Returns `null` when the archive has no data for this tile (over-
   * zoomed past `maxzoom`, or coord outside covered extent). Callers
   * should serve a 204 in that case — a 404 confuses MapLibre which
   * would give up instead of over-zooming.
   */
  async getTile(z: number, x: number, y: number): Promise<Uint8Array | null> {
    this.assertEnabled();
    try {
      const tile = await this.pmtiles!.getZxy(z, x, y);
      if (!tile) return null;
      return new Uint8Array(tile.data);
    } catch (err) {
      // A concurrent archive swap raises EtagMismatch — pmtiles has
      // already invalidated its internal cache, we just retry once.
      if (err instanceof EtagMismatch) {
        try {
          const tile = await this.pmtiles!.getZxy(z, x, y);
          return tile ? new Uint8Array(tile.data) : null;
        } catch (retryErr) {
          throw this.wrapS3Error(retryErr);
        }
      }
      throw this.wrapS3Error(err);
    }
  }

  /**
   * Fetches a raw object from the tiles bucket (used by glyphs and
   * sprites). Returned as a Node `Buffer` because the controller
   * writes it directly to the response stream.
   */
  async getObject(
    key: string,
  ): Promise<{ body: Buffer; contentType: string | undefined; etag: string | undefined }> {
    this.assertEnabled();
    try {
      const resp = await this.client!.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!resp.Body) throw new Error('EMPTY_BODY');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bytes = await (resp.Body as any).transformToByteArray();
      return {
        body: Buffer.from(bytes as Uint8Array),
        contentType: resp.ContentType,
        etag: resp.ETag,
      };
    } catch (err) {
      throw this.wrapS3Error(err);
    }
  }

  glyphsKey(fontstack: string, range: string): string {
    // Nominatim-style path traversal was already rejected by the
    // controller layer; joining here is safe.
    return `${this.glyphsPrefix}${fontstack}/${range}.pbf`;
  }

  spritesKey(name: string, scale: '' | '@2x', ext: 'png' | 'json'): string {
    return `${this.spritesPrefix}${name}${scale}.${ext}`;
  }

  /**
   * Builds the MapLibre Style Spec JSON document served at
   * `/maps/style.json`. All URLs point at this API's origin so the
   * FE never contacts an external tile / font / sprite host.
   *
   * `apiBaseUrl` is the externally-reachable API base URL WITHOUT
   * trailing slash and WITHOUT the `/api/v1` prefix — matches
   * `PUBLIC_API_URL`. The controller composes the final URLs by
   * appending `/api/v1/maps/...`.
   */
  buildStyle(apiBaseUrl: string): Record<string, unknown> {
    const base = apiBaseUrl.replace(/\/+$/, '');
    return {
      version: 8,
      name: 'Workpulse Basemap',
      // Direct MapLibre at our proxied glyphs endpoint. The `{fontstack}`
      // and `{range}` placeholders are Style Spec template vars,
      // filled in by MapLibre at request time.
      glyphs: `${base}/api/v1/maps/glyphs/{fontstack}/{range}.pbf`,
      sprite: `${base}/api/v1/maps/sprites/default`,
      sources: {
        // Server-decoded tiles: the API resolves each `(z,x,y)` against
        // the PMTiles archive on MinIO and returns raw MVT bytes. That
        // keeps the client bundle free of pmtiles.js AND means every
        // downstream URL in this style stays under our own origin
        // (nothing to allowlist in the FE's CSP beyond `NEXT_PUBLIC_API_URL`).
        protomaps: {
          type: 'vector',
          tiles: [`${base}/api/v1/maps/tiles/{z}/{x}/{y}.mvt`],
          minzoom: 0,
          maxzoom: 15,
          attribution:
            '© <a href="https://openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
        },
      },
      // Minimal Protomaps-Basemaps-style layer set — enough to render
      // land + water + roads + place labels. A tenant that wants a
      // fancier style can override by shipping their own JSON.
      layers: minimalBaseLayers(),
    };
  }

  private assertEnabled(): void {
    if (!this.enabled || !this.client || !this.pmtiles) {
      throw new ServiceUnavailableException({
        code: 'MAPS_DISABLED',
        message: 'Map endpoints are disabled on this instance.',
      });
    }
  }

  private wrapS3Error(err: unknown): Error {
    if (err instanceof NoSuchKey) {
      return new NotFoundException({
        code: 'MAPS_ARCHIVE_MISSING',
        message:
          'Map data has not been seeded to storage. Ops must run the bootstrap procedure (see docs/OPS/MAP-BOOTSTRAP.md).',
      });
    }
    if (err instanceof S3ServiceException && err.$metadata?.httpStatusCode === 404) {
      return new NotFoundException({
        code: 'MAPS_OBJECT_MISSING',
        message: 'Requested map asset not found in storage.',
      });
    }
    this.logger.error(
      `Map upstream failure: ${err instanceof Error ? err.message : String(err)}`,
    );
    return new ServiceUnavailableException({
      code: 'MAPS_UPSTREAM_UNAVAILABLE',
      message: 'Map storage upstream is currently unavailable. Retry shortly.',
    });
  }
}

/**
 * Very small default style — the goal is to have SOMETHING renderable
 * out-of-the-box so integrators can validate that the pipeline works
 * before ops installs a curated Protomaps style. Real deployments
 * should ship their own style JSON (see the ADR followups).
 */
function minimalBaseLayers(): unknown[] {
  return [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#f4f1eb' },
    },
    {
      id: 'earth',
      type: 'fill',
      source: 'protomaps',
      'source-layer': 'earth',
      paint: { 'fill-color': '#e0dfd8' },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'protomaps',
      'source-layer': 'water',
      paint: { 'fill-color': '#a0c8f0' },
    },
    {
      id: 'roads-minor',
      type: 'line',
      source: 'protomaps',
      'source-layer': 'roads',
      minzoom: 12,
      paint: { 'line-color': '#ffffff', 'line-width': 1 },
    },
    {
      id: 'roads-major',
      type: 'line',
      source: 'protomaps',
      'source-layer': 'roads',
      filter: ['in', ['get', 'pmap:kind'], ['literal', ['highway', 'major_road']]],
      paint: { 'line-color': '#ffffff', 'line-width': 2.5 },
    },
    {
      id: 'places',
      type: 'symbol',
      source: 'protomaps',
      'source-layer': 'places',
      minzoom: 6,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
      },
      paint: {
        'text-color': '#333',
        'text-halo-color': '#fff',
        'text-halo-width': 1.2,
      },
    },
  ];
}
