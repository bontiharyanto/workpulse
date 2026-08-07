import type { ConfigService } from '@nestjs/config';

import { MapsService } from './maps.service';

interface BaseEnv {
  MAPS_ENABLED: 'true' | 'false';
  MAPS_TILES_BUCKET: string;
  MAPS_PMTILES_KEY: string;
  MAPS_GLYPHS_PREFIX: string;
  MAPS_SPRITES_PREFIX: string;
  S3_REGION: string;
  S3_ENDPOINT: string;
  S3_FORCE_PATH_STYLE: boolean;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
}

const BASE_ENV: BaseEnv = {
  MAPS_ENABLED: 'false',
  MAPS_TILES_BUCKET: 'workpulse-maptiles',
  MAPS_PMTILES_KEY: 'indonesia.pmtiles',
  MAPS_GLYPHS_PREFIX: 'glyphs/',
  MAPS_SPRITES_PREFIX: 'sprites/',
  S3_REGION: 'us-east-1',
  S3_ENDPOINT: 'http://minio:9000',
  S3_FORCE_PATH_STYLE: true,
  S3_ACCESS_KEY_ID: 'workpulse',
  S3_SECRET_ACCESS_KEY: 'workpulse-secret',
};

function makeConfig(overrides: Partial<BaseEnv> = {}): ConfigService<Record<string, unknown>, true> {
  const merged = { ...BASE_ENV, ...overrides };
  return {
    get: (key: keyof BaseEnv) => merged[key],
  } as unknown as ConfigService<Record<string, unknown>, true>;
}

describe('MapsService', () => {
  it('is disabled by default (MAPS_ENABLED=false) — every entry point throws 503', async () => {
    const svc = new MapsService(makeConfig());
    await expect(svc.getTile(0, 0, 0)).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ code: 'MAPS_DISABLED' }),
    });
    await expect(svc.getObject('glyphs/x/0-255.pbf')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('refuses to boot when MAPS_ENABLED=true but S3 credentials are missing', () => {
    expect(
      () =>
        new MapsService(
          makeConfig({
            MAPS_ENABLED: 'true',
            S3_ACCESS_KEY_ID: '',
            S3_SECRET_ACCESS_KEY: '',
          }),
        ),
    ).toThrow(/S3_ACCESS_KEY_ID/);
  });

  it('builds a Style Spec 8 document with same-origin URLs', () => {
    const svc = new MapsService(makeConfig());
    const style = svc.buildStyle('https://api.example.com/');
    expect(style.version).toBe(8);
    // Tiles URL points at our API, NOT tile.openstreetmap.org.
    const sources = style.sources as Record<string, { tiles: string[]; attribution: string }>;
    const protomaps = sources.protomaps;
    expect(protomaps).toBeDefined();
    expect(protomaps!.tiles[0]).toBe(
      'https://api.example.com/api/v1/maps/tiles/{z}/{x}/{y}.mvt',
    );
    expect(protomaps!.attribution).toMatch(/openstreetmap/i);
    // Glyphs + sprites both proxied
    expect(style.glyphs).toBe(
      'https://api.example.com/api/v1/maps/glyphs/{fontstack}/{range}.pbf',
    );
    expect(style.sprite).toBe('https://api.example.com/api/v1/maps/sprites/default');
    // Layer list is non-empty and references only our declared source
    const layers = style.layers as Array<{ source?: string }>;
    for (const layer of layers) {
      if (layer.source) expect(layer.source).toBe('protomaps');
    }
  });

  it('strips trailing slash from apiBaseUrl idempotently', () => {
    const svc = new MapsService(makeConfig());
    const withSlash = svc.buildStyle('https://api.example.com/');
    const withoutSlash = svc.buildStyle('https://api.example.com');
    expect(withSlash).toEqual(withoutSlash);
  });

  it('composes glyph and sprite S3 keys from configured prefixes', () => {
    const svc = new MapsService(makeConfig());
    expect(svc.glyphsKey('Noto Sans Regular', '0-255')).toBe(
      'glyphs/Noto Sans Regular/0-255.pbf',
    );
    expect(svc.spritesKey('default', '', 'png')).toBe('sprites/default.png');
    expect(svc.spritesKey('default', '@2x', 'json')).toBe('sprites/default@2x.json');
  });
});
