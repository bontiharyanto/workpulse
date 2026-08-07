/**
 * Pure helpers for validating map tile coordinates. Isolated from
 * Nest and S3 so they can be exhaustively unit-tested.
 *
 * # Tile coordinate space
 *
 * Web Mercator tiles ("XYZ scheme") are indexed by three integers:
 *
 *   z ∈ [0, 24]   — zoom level. z=0 is the whole world in one tile;
 *                   each level up doubles resolution.
 *   x, y ∈ [0, 2^z - 1] — tile column / row at that zoom.
 *
 * We cap z at 24 not because MapLibre couldn't render higher (it
 * can, via `overzoom`) but because a well-authored PMTiles archive
 * tops out around z=15 for a country-sized extract. Beyond that,
 * the archive returns "no tile" and we don't want to serve
 * gratuitous byte-range queries against MinIO.
 */

export const MAX_ZOOM = 24;

/**
 * Rejects malformed / out-of-range XYZ coordinates before any S3
 * hit. Returns a parsed triple on success, throws a plain `Error`
 * otherwise — the controller maps the error to a 400.
 */
export function parseTileCoord(rawZ: string, rawX: string, rawY: string): {
  z: number;
  x: number;
  y: number;
} {
  // Strict integer test — `Number.parseInt` happily accepts `"1.5"`
  // and returns `1`, which would let a probing client sneak decimal
  // input past validation. `/^-?\d+$/` is the tight check.
  if (!/^-?\d+$/.test(rawZ) || !/^-?\d+$/.test(rawX) || !/^-?\d+$/.test(rawY)) {
    throw new Error('TILE_COORD_NOT_INTEGER');
  }
  const z = Number.parseInt(rawZ, 10);
  const x = Number.parseInt(rawX, 10);
  const y = Number.parseInt(rawY, 10);

  if (
    !Number.isSafeInteger(z) ||
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y)
  ) {
    throw new Error('TILE_COORD_NOT_INTEGER');
  }
  if (z < 0 || z > MAX_ZOOM) {
    throw new Error('TILE_ZOOM_OUT_OF_RANGE');
  }
  const max = 2 ** z - 1;
  if (x < 0 || x > max || y < 0 || y > max) {
    throw new Error('TILE_COORD_OUT_OF_BOUNDS');
  }
  return { z, x, y };
}

/**
 * Sanitises a font-stack segment for `/maps/glyphs/{fontstack}/{range}.pbf`.
 * MapLibre requests fontstacks like `Noto Sans Regular,Arial Unicode MS`
 * as a single URL segment (comma-joined, URL-encoded). We only need
 * to reject shenanigans like `..` / `/` — Nominatim-style path
 * traversal — before mapping to an S3 key. Empty comma-separated
 * items are dropped.
 */
export function sanitizeFontstackSegment(raw: string): string {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) throw new Error('FONTSTACK_EMPTY');
  for (const part of parts) {
    if (part.includes('/') || part.includes('..') || part.includes('\\')) {
      throw new Error('FONTSTACK_INVALID');
    }
    if (part.length > 80) throw new Error('FONTSTACK_INVALID');
  }
  return parts.join(',');
}

/**
 * MapLibre glyph ranges are named `<start>-<end>.pbf` where both
 * are multiples of 256 within `[0, 65535]`. Anything else is either
 * a client bug or a probing request — reject fast.
 */
export function parseGlyphRange(raw: string): { start: number; end: number } {
  const m = raw.match(/^(\d+)-(\d+)$/);
  if (!m || !m[1] || !m[2]) throw new Error('GLYPH_RANGE_INVALID');
  const start = Number.parseInt(m[1], 10);
  const end = Number.parseInt(m[2], 10);
  if (start < 0 || end > 65_535 || start >= end) {
    throw new Error('GLYPH_RANGE_INVALID');
  }
  if (start % 256 !== 0 || (end + 1) % 256 !== 0) {
    throw new Error('GLYPH_RANGE_INVALID');
  }
  return { start, end };
}

/**
 * Sprite requests come in as `{name}.{ext}` or `{name}@{scale}.{ext}`.
 * We only allow `png`/`json` extensions and `@2x` scale variants —
 * everything else is out.
 */
export function parseSpriteAsset(raw: string): {
  name: string;
  scale: '' | '@2x';
  ext: 'png' | 'json';
} {
  const m = raw.match(/^([a-zA-Z0-9_-]{1,40})(@2x)?\.(png|json)$/);
  if (!m || !m[1] || !m[3]) throw new Error('SPRITE_ASSET_INVALID');
  return {
    name: m[1],
    scale: (m[2] ?? '') as '' | '@2x',
    ext: m[3] as 'png' | 'json',
  };
}
