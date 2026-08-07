import {
  MAX_ZOOM,
  parseGlyphRange,
  parseSpriteAsset,
  parseTileCoord,
  sanitizeFontstackSegment,
} from './tile-coord';

describe('parseTileCoord', () => {
  it('accepts world tile', () => {
    expect(parseTileCoord('0', '0', '0')).toEqual({ z: 0, x: 0, y: 0 });
  });

  it('accepts max-valid tile at each of a few zooms', () => {
    for (const z of [1, 5, 10, 15]) {
      const max = 2 ** z - 1;
      expect(parseTileCoord(String(z), String(max), String(max))).toEqual({ z, x: max, y: max });
    }
  });

  it('accepts maximum allowed zoom', () => {
    expect(parseTileCoord(String(MAX_ZOOM), '0', '0').z).toBe(MAX_ZOOM);
  });

  it('rejects negative components', () => {
    expect(() => parseTileCoord('-1', '0', '0')).toThrow('TILE_ZOOM_OUT_OF_RANGE');
    expect(() => parseTileCoord('5', '-1', '0')).toThrow('TILE_COORD_OUT_OF_BOUNDS');
  });

  it('rejects zoom above cap', () => {
    expect(() => parseTileCoord(String(MAX_ZOOM + 1), '0', '0')).toThrow(
      'TILE_ZOOM_OUT_OF_RANGE',
    );
  });

  it('rejects x/y beyond 2^z-1', () => {
    // z=2 → max = 3
    expect(() => parseTileCoord('2', '4', '0')).toThrow('TILE_COORD_OUT_OF_BOUNDS');
    expect(() => parseTileCoord('2', '0', '4')).toThrow('TILE_COORD_OUT_OF_BOUNDS');
  });

  it('rejects non-integer / non-numeric input (probe hardening)', () => {
    expect(() => parseTileCoord('1.5', '0', '0')).toThrow('TILE_COORD_NOT_INTEGER');
    expect(() => parseTileCoord('abc', '0', '0')).toThrow('TILE_COORD_NOT_INTEGER');
    expect(() => parseTileCoord('', '0', '0')).toThrow('TILE_COORD_NOT_INTEGER');
  });
});

describe('sanitizeFontstackSegment', () => {
  it('accepts a single font name', () => {
    expect(sanitizeFontstackSegment('Noto Sans Regular')).toBe('Noto Sans Regular');
  });

  it('accepts a comma-joined stack + trims whitespace', () => {
    expect(sanitizeFontstackSegment('Noto Sans Regular,  Arial Unicode MS ')).toBe(
      'Noto Sans Regular,Arial Unicode MS',
    );
  });

  it.each(['../etc/passwd', 'Noto/../Sans', 'Noto Sans\\Regular'])(
    'rejects traversal-looking input %s',
    (bad) => {
      expect(() => sanitizeFontstackSegment(bad)).toThrow('FONTSTACK_INVALID');
    },
  );

  it('rejects empty stacks', () => {
    expect(() => sanitizeFontstackSegment('')).toThrow('FONTSTACK_EMPTY');
    expect(() => sanitizeFontstackSegment(',,')).toThrow('FONTSTACK_EMPTY');
  });

  it('rejects fonts with absurd length (probe hardening)', () => {
    expect(() => sanitizeFontstackSegment('x'.repeat(200))).toThrow('FONTSTACK_INVALID');
  });
});

describe('parseGlyphRange', () => {
  it('accepts the canonical 0-255 range', () => {
    expect(parseGlyphRange('0-255')).toEqual({ start: 0, end: 255 });
  });

  it('accepts a mid-range 8192-8447', () => {
    expect(parseGlyphRange('8192-8447')).toEqual({ start: 8192, end: 8447 });
  });

  it.each(['abc', '0', '0-100', '256-256', '100-99', '-256-0', '0-65536'])(
    'rejects malformed range %s',
    (bad) => {
      expect(() => parseGlyphRange(bad)).toThrow('GLYPH_RANGE_INVALID');
    },
  );
});

describe('parseSpriteAsset', () => {
  it('parses the four canonical sprite files', () => {
    expect(parseSpriteAsset('default.png')).toEqual({
      name: 'default',
      scale: '',
      ext: 'png',
    });
    expect(parseSpriteAsset('default.json')).toEqual({
      name: 'default',
      scale: '',
      ext: 'json',
    });
    expect(parseSpriteAsset('default@2x.png')).toEqual({
      name: 'default',
      scale: '@2x',
      ext: 'png',
    });
    expect(parseSpriteAsset('default@2x.json')).toEqual({
      name: 'default',
      scale: '@2x',
      ext: 'json',
    });
  });

  it.each(['default.svg', 'default@3x.png', 'de fault.png', '../default.png', 'default'])(
    'rejects %s',
    (bad) => {
      expect(() => parseSpriteAsset(bad)).toThrow('SPRITE_ASSET_INVALID');
    },
  );
});
