import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpStatus,
  Inject,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import type { Response as ExpressResponse } from 'express';

import {
  parseGlyphRange,
  parseSpriteAsset,
  parseTileCoord,
  sanitizeFontstackSegment,
} from './domain/tile-coord';
import { GeocodeService } from './geocode.service';
import { MapsService } from './maps.service';
import { Public } from '../auth/decorators/public.decorator';

import type { EnvConfig } from '../config/env.validation';

/**
 * `/maps/*` — read-through cache for the tenant-neutral map bundle.
 * See ADR-0042 for the full spec.
 *
 * # Auth posture
 *
 * Tiles, glyphs, sprites, and the style JSON are `@Public()` because
 * they hold NO tenant data. The archive is the same across the entire
 * deploy — leaking them just gives the recipient a copy of an
 * OpenStreetMap extract, which the license allows anyway.
 *
 * `/maps/geocode` is authenticated (JWT default guard runs; no
 * `@Public()`) so we can log the caller and enforce per-user quotas.
 *
 * # Caching model
 *
 * Every static endpoint sets `Cache-Control: public, immutable` with
 * a long TTL so browsers + CDNs cache aggressively. Ops invalidates
 * by bumping `MAPS_PMTILES_KEY` (new object key) — old URLs continue
 * to serve until their TTL elapses, avoiding thundering herds.
 */
@ApiTags('maps')
@Controller('maps')
export class MapsController {
  constructor(
    private readonly maps: MapsService,
    private readonly geocode: GeocodeService,
    @Inject(ConfigService) private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  @Get('style.json')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  style(): Record<string, unknown> {
    const publicApiUrl = this.config.get('PUBLIC_API_URL', { infer: true });
    return this.maps.buildStyle(publicApiUrl);
  }

  @Get('tiles/:z/:x/:yWithExt')
  @Public()
  @Header('Cache-Control', 'public, max-age=604800, immutable')
  @Header('Content-Type', 'application/vnd.mapbox-vector-tile')
  @Header('Content-Encoding', 'gzip')
  async tile(
    @Param('z') z: string,
    @Param('x') x: string,
    @Param('yWithExt') yWithExt: string,
    @Res({ passthrough: true }) res: ExpressResponse,
  ): Promise<Buffer | null> {
    const yMatch = yWithExt.match(/^(\d+)\.mvt$/);
    if (!yMatch || !yMatch[1]) {
      throw new BadRequestException({
        code: 'TILE_URL_INVALID',
        message: 'Tile URL must end in `.mvt`.',
      });
    }
    let coord;
    try {
      coord = parseTileCoord(z, x, yMatch[1]);
    } catch (err) {
      throw new BadRequestException({
        code: err instanceof Error ? err.message : 'TILE_URL_INVALID',
        message: 'Tile coordinate is invalid.',
      });
    }

    const tile = await this.maps.getTile(coord.z, coord.x, coord.y);
    if (!tile) {
      // 204 with empty body is what MapLibre expects when a tile is
      // missing from an archive (over-zoomed, off-extent). A 404
      // would make MapLibre give up and stop over-zooming from
      // lower levels, degrading the UX at high zooms outside the
      // covered extent.
      res.status(HttpStatus.NO_CONTENT);
      // Content-Encoding: gzip becomes misleading on an empty body —
      // strip it before the reply flushes.
      res.removeHeader('Content-Encoding');
      return null;
    }
    return Buffer.from(tile);
  }

  @Get('glyphs/:fontstack/:range')
  @Public()
  @Header('Cache-Control', 'public, max-age=2592000, immutable')
  @Header('Content-Type', 'application/x-protobuf')
  async glyphs(
    @Param('fontstack') rawFontstack: string,
    @Param('range') rawRange: string,
  ): Promise<Buffer> {
    let fontstack: string;
    let rangeStr: string;
    try {
      fontstack = sanitizeFontstackSegment(decodeURIComponent(rawFontstack));
      const parsed = parseGlyphRange(rawRange.replace(/\.pbf$/, ''));
      rangeStr = `${parsed.start}-${parsed.end}`;
    } catch (err) {
      throw new BadRequestException({
        code: err instanceof Error ? err.message : 'GLYPH_URL_INVALID',
        message: 'Glyph URL is invalid.',
      });
    }
    const key = this.maps.glyphsKey(fontstack, rangeStr);
    const { body } = await this.maps.getObject(key);
    return body;
  }

  @Get('sprites/:asset')
  @Public()
  @Header('Cache-Control', 'public, max-age=2592000, immutable')
  async sprite(
    @Param('asset') rawAsset: string,
    @Res({ passthrough: true }) res: ExpressResponse,
  ): Promise<Buffer> {
    let parsed;
    try {
      parsed = parseSpriteAsset(rawAsset);
    } catch (err) {
      throw new BadRequestException({
        code: err instanceof Error ? err.message : 'SPRITE_URL_INVALID',
        message: 'Sprite URL is invalid.',
      });
    }
    const key = this.maps.spritesKey(parsed.name, parsed.scale, parsed.ext);
    const { body, contentType } = await this.maps.getObject(key);
    res.setHeader(
      'Content-Type',
      contentType ?? (parsed.ext === 'png' ? 'image/png' : 'application/json'),
    );
    return body;
  }

  @Get('geocode')
  async geocodeSearch(
    @Query('q') q?: string,
    @Query('limit') limitRaw?: string,
    @Query('countrycodes') countryRaw?: string,
  ): Promise<{ results: Array<{ displayName: string; latitude: number; longitude: number }> }> {
    if (!q || typeof q !== 'string') {
      throw new BadRequestException({
        code: 'GEOCODE_QUERY_MISSING',
        message: 'Provide `q` with at least 3 characters.',
      });
    }
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 5;
    if (!Number.isFinite(limit) || limit < 1 || limit > 10) {
      throw new BadRequestException({
        code: 'GEOCODE_LIMIT_INVALID',
        message: '`limit` must be an integer between 1 and 10.',
      });
    }
    const results = await this.geocode.search(q, {
      limit,
      countryCode: countryRaw,
    });
    return { results };
  }
}
