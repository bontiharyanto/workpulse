import {
  validateResolvedHost,
  validateUrl,
  validateUrlSyntax,
} from './url-guard';

describe('validateUrlSyntax (Fase 32e)', () => {
  it('accepts a well-formed https URL', () => {
    const result = validateUrlSyntax('https://payroll.example.com/hooks', {
      httpsRequired: true,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects malformed URLs', () => {
    const result = validateUrlSyntax('not a url', { httpsRequired: false });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('MALFORMED_URL');
  });

  it('rejects non-http schemes', () => {
    const result = validateUrlSyntax('ftp://x.example.com/y', {
      httpsRequired: false,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('INVALID_SCHEME');
  });

  it('refuses http:// when httpsRequired', () => {
    const result = validateUrlSyntax('http://x.example.com/y', {
      httpsRequired: true,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('HTTPS_REQUIRED');
  });

  it('permits http:// when httpsRequired is false (dev)', () => {
    const result = validateUrlSyntax('http://x.example.com/y', {
      httpsRequired: false,
    });
    expect(result.ok).toBe(true);
  });

  it('refuses embedded credentials', () => {
    const result = validateUrlSyntax('https://user:pass@x.example.com', {
      httpsRequired: false,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('CREDENTIALS_IN_URL');
  });

  it('refuses the cloud-metadata IP literal outright', () => {
    const result = validateUrlSyntax('http://169.254.169.254/latest/meta-data', {
      httpsRequired: false,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('BLOCKED_HOST');
  });
});

describe('validateResolvedHost (Fase 32e)', () => {
  it('short-circuits when blockPrivateIps is false', async () => {
    const result = await validateResolvedHost('localhost', {
      blockPrivateIps: false,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an IPv4 literal in the loopback range', async () => {
    const result = await validateResolvedHost('127.0.0.1', {
      blockPrivateIps: true,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('PRIVATE_IP');
  });

  it('rejects an IPv4 literal in the 10.0.0.0/8 range', async () => {
    const result = await validateResolvedHost('10.5.6.7', {
      blockPrivateIps: true,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('PRIVATE_IP');
  });

  it('rejects an IPv4 literal in the 172.16/12 range', async () => {
    const result = await validateResolvedHost('172.20.0.1', {
      blockPrivateIps: true,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('PRIVATE_IP');
  });

  it('accepts a public IPv4 literal', async () => {
    const result = await validateResolvedHost('8.8.8.8', {
      blockPrivateIps: true,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects IPv6 loopback', async () => {
    const result = await validateResolvedHost('::1', {
      blockPrivateIps: true,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('PRIVATE_IP');
  });

  it('rejects IPv6 unique-local (fd00::/8)', async () => {
    const result = await validateResolvedHost('fd12:3456::1', {
      blockPrivateIps: true,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('PRIVATE_IP');
  });
});

describe('validateUrl (Fase 32e — full pipeline)', () => {
  it('composes syntax + resolved-host checks', async () => {
    const result = await validateUrl('https://127.0.0.1/webhook', {
      httpsRequired: true,
      blockPrivateIps: true,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('PRIVATE_IP');
  });
});
