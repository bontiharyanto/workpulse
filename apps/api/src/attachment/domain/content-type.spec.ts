import {
  ALLOWED_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  extensionForContentType,
  isAllowedContentType,
} from './content-type';

describe('isAllowedContentType', () => {
  it.each([
    ['image/jpeg', true],
    ['image/png', true],
    ['image/webp', true],
    ['application/pdf', true],
    ['application/x-msdownload', false],
    ['image/svg+xml', false], // no SVG (XSS via inline scripts)
    ['text/html', false],
    ['', false],
  ])('%s → %s', (mime, expected) => {
    expect(isAllowedContentType(mime)).toBe(expected);
  });
});

describe('extensionForContentType', () => {
  it('maps whitelisted MIME to canonical extension', () => {
    expect(extensionForContentType('image/jpeg')).toBe('jpg');
    expect(extensionForContentType('application/pdf')).toBe('pdf');
  });

  it('throws for anything else', () => {
    expect(() => extensionForContentType('image/gif')).toThrow(RangeError);
  });
});

describe('constants', () => {
  it('MAX_UPLOAD_BYTES is 5 MiB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
  });

  it('map has exactly the documented entries', () => {
    expect([...ALLOWED_CONTENT_TYPES.keys()].sort()).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });
});
