import type { ConfigService } from '@nestjs/config';

import { GeocodeService } from './geocode.service';

interface Env {
  MAPS_GEOCODE_UPSTREAM: string;
  MAPS_GEOCODE_USER_AGENT: string;
  MAPS_GEOCODE_QPS: number;
  MAPS_GEOCODE_CACHE_TTL_S: number;
}

const ENV: Env = {
  MAPS_GEOCODE_UPSTREAM: 'https://nominatim.example.com',
  MAPS_GEOCODE_USER_AGENT: 'Workpulse/test',
  MAPS_GEOCODE_QPS: 2,
  MAPS_GEOCODE_CACHE_TTL_S: 60,
};

function makeConfig(overrides: Partial<Env> = {}): ConfigService<Record<string, unknown>, true> {
  const merged = { ...ENV, ...overrides };
  return {
    get: (key: keyof Env) => merged[key],
  } as unknown as ConfigService<Record<string, unknown>, true>;
}

function makeService(overrides?: Partial<typeof ENV>): GeocodeService {
  return new GeocodeService(makeConfig(overrides));
}

function mockNominatimResponse(rows: unknown, init: ResponseInit = {}): void {
  // Fetch Response bodies can only be consumed once — return a fresh
  // Response per call so a burst of requests each sees a live body.
  global.fetch = jest.fn().mockImplementation(
    () =>
      new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
      }),
  ) as jest.Mock;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GeocodeService', () => {
  it('returns empty for short queries without hitting upstream', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const svc = makeService();
    const out = await svc.search('a', { limit: 5 });
    expect(out).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('proxies a real query and narrows the response shape', async () => {
    mockNominatimResponse([
      {
        lat: '-6.2088',
        lon: '106.8456',
        display_name: 'Jakarta, Indonesia',
        importance: 0.8,
        licence: 'ODbL',
      },
    ]);
    const svc = makeService();
    const out = await svc.search('Jakarta', { limit: 5 });
    expect(out).toEqual([
      { latitude: -6.2088, longitude: 106.8456, displayName: 'Jakarta, Indonesia' },
    ]);
    // Verify we sent the AUP-required User-Agent
    const req = (global.fetch as jest.Mock).mock.calls[0];
    expect(req[1].headers['User-Agent']).toBe('Workpulse/test');
    expect(req[0]).toContain('countrycodes=id');
  });

  it('caches identical queries within the TTL', async () => {
    mockNominatimResponse([
      { lat: '1', lon: '2', display_name: 'Somewhere' },
    ]);
    const svc = makeService();
    await svc.search('bandung station', { limit: 5 });
    await svc.search('BANDUNG STATION', { limit: 5 });
    await svc.search('   bandung station  ', { limit: 5 });
    expect(global.fetch as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('enforces the QPS gate — burst above `qps` throws 429', async () => {
    mockNominatimResponse([{ lat: '0', lon: '0', display_name: 'x' }]);
    const svc = makeService({ MAPS_GEOCODE_QPS: 2 });
    // 2 tokens available on cold start
    await svc.search('one', { limit: 1 });
    await svc.search('two', { limit: 1 });
    await expect(svc.search('three', { limit: 1 })).rejects.toMatchObject({
      status: 429,
    });
  });

  it('surfaces upstream 429 as a mapped TooManyRequests', async () => {
    mockNominatimResponse('rate limit', { status: 429 });
    const svc = makeService();
    await expect(svc.search('jakarta pusat', { limit: 5 })).rejects.toMatchObject({
      status: 429,
      response: expect.objectContaining({ code: 'GEOCODE_RATE_LIMITED' }),
    });
  });

  it('surfaces network failure as 503 (not 500)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ENETUNREACH')) as jest.Mock;
    const svc = makeService();
    await expect(svc.search('jakarta pusat', { limit: 5 })).rejects.toMatchObject({
      status: 503,
    });
  });

  it('rejects non-array upstream payload as 502', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ oops: true }), { status: 200 })) as jest.Mock;
    const svc = makeService();
    await expect(svc.search('foo bar', { limit: 5 })).rejects.toMatchObject({
      status: 502,
    });
  });

  it('drops malformed rows silently rather than throwing', async () => {
    mockNominatimResponse([
      { lat: 'abc', lon: '106', display_name: 'bad lat' },
      { lat: '-6', lon: '106', display_name: '' },
      { lat: '-6', lon: '106', display_name: 'good one' },
    ]);
    const svc = makeService();
    const out = await svc.search('mixed', { limit: 5 });
    expect(out).toHaveLength(1);
    expect(out[0]?.displayName).toBe('good one');
  });
});
