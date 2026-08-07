import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * `HttpException` subclass for 429 (Nest's stdlib doesn't ship one
 * as of v10). Kept local — the rest of the app maps 429 via the
 * throttler guard so this is the first bespoke throw site.
 */
class TooManyRequestsException extends HttpException {
  constructor(response: string | Record<string, unknown>) {
    super(response, HttpStatus.TOO_MANY_REQUESTS);
  }
}

import type { EnvConfig } from '../config/env.validation';

/**
 * Result shape returned by the upstream Nominatim `/search` endpoint,
 * narrowed to the fields the FE actually uses. Nominatim returns
 * many more (bounding boxes, class, importance, licence text, …)
 * that we strip so the wire payload stays lean AND future changes
 * to Nominatim's response can't leak into our clients.
 */
export interface GeocodeResult {
  displayName: string;
  latitude: number;
  longitude: number;
}

/**
 * Server-side proxy for map geocoding.
 *
 * Two things this class is not:
 *
 *   * It is NOT a rate-limiter for how many geocode calls a single
 *     tenant / user can make — that lives at the NestJS `@Throttle`
 *     level on the controller. This is a *global* token bucket for
 *     the upstream cap we promise to Nominatim (their AUP is 1
 *     req/second per host regardless of caller).
 *   * It is NOT a semantic search backend — it is a passthrough with
 *     the smallest sensible cache. Semantic + fuzzy matching is
 *     Nominatim's job, we just relay bytes.
 *
 * # Cache
 *
 * Query strings + limit + country bias identify a lookup uniquely
 * enough for a 24h TTL. Location-y data is not personal enough to
 * warrant per-user cache partitions.
 *
 * # QPS gate
 *
 * A simple in-memory token bucket. Refills at `MAPS_GEOCODE_QPS`
 * per second. When exhausted, `search()` throws
 * `TooManyRequestsException` (mapped to 429). This preserves
 * per-tenant fairness — a busy tenant that hits 429 fails fast
 * rather than queueing behind the bucket and holding an HTTP
 * connection open.
 */
@Injectable()
export class GeocodeService {
  private readonly logger = new Logger(GeocodeService.name);
  private readonly upstream: string;
  private readonly userAgent: string;
  private readonly qps: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, { at: number; results: GeocodeResult[] }>();

  private tokens: number;
  private lastRefill: number;

  constructor(@Inject(ConfigService) config: ConfigService<EnvConfig, true>) {
    this.upstream = config.get('MAPS_GEOCODE_UPSTREAM', { infer: true });
    this.userAgent = config.get('MAPS_GEOCODE_USER_AGENT', { infer: true });
    this.qps = config.get('MAPS_GEOCODE_QPS', { infer: true });
    this.cacheTtlMs = config.get('MAPS_GEOCODE_CACHE_TTL_S', { infer: true }) * 1000;
    this.tokens = this.qps;
    this.lastRefill = Date.now();
  }

  async search(rawQuery: string, opts: { limit: number; countryCode?: string }): Promise<GeocodeResult[]> {
    const query = rawQuery.trim();
    if (query.length < 3) return [];
    const limit = Math.min(Math.max(opts.limit, 1), 10);
    const countryCode = opts.countryCode?.trim().toLowerCase() ?? 'id';

    const cacheKey = `${query.toLowerCase()}|${limit}|${countryCode}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) {
      return cached.results;
    }

    this.spendToken();

    const url = new URL(`${this.upstream.replace(/\/+$/, '')}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', String(limit));
    if (countryCode) url.searchParams.set('countrycodes', countryCode);
    url.searchParams.set('accept-language', 'id,en');

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          // Nominatim AUP requires a descriptive User-Agent so ops
          // can contact us if we misbehave. Anonymous / default UA
          // requests get throttled.
          'User-Agent': this.userAgent,
        },
        signal: AbortSignal.timeout(8_000),
      });
    } catch (err) {
      this.logger.warn(
        `Geocode upstream unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException({
        code: 'GEOCODE_UPSTREAM_UNAVAILABLE',
        message: 'Address lookup service is unreachable. Try again shortly.',
      });
    }

    if (response.status === 429 || response.status === 503) {
      throw new TooManyRequestsException({
        code: 'GEOCODE_RATE_LIMITED',
        message: 'Address lookup service is throttling us. Try again shortly.',
      });
    }
    if (!response.ok) {
      throw new BadGatewayException({
        code: 'GEOCODE_UPSTREAM_ERROR',
        message: `Address lookup returned HTTP ${response.status}.`,
      });
    }

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new BadGatewayException({
        code: 'GEOCODE_UPSTREAM_ERROR',
        message: 'Address lookup returned invalid JSON.',
      });
    }
    if (!Array.isArray(raw)) {
      throw new BadGatewayException({
        code: 'GEOCODE_UPSTREAM_ERROR',
        message: 'Address lookup returned unexpected payload.',
      });
    }

    const results: GeocodeResult[] = raw
      .map((r) => {
        if (typeof r !== 'object' || r === null) return null;
        const obj = r as Record<string, unknown>;
        const lat = typeof obj.lat === 'string' ? Number.parseFloat(obj.lat) : NaN;
        const lon = typeof obj.lon === 'string' ? Number.parseFloat(obj.lon) : NaN;
        const displayName = typeof obj.display_name === 'string' ? obj.display_name : '';
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !displayName) return null;
        return { latitude: lat, longitude: lon, displayName };
      })
      .filter((r): r is GeocodeResult => r !== null)
      .slice(0, limit);

    this.cache.set(cacheKey, { at: Date.now(), results });
    // Keep the cache from growing unbounded on production. LRU-ish:
    // once we cross 512 entries, drop the oldest 128.
    if (this.cache.size > 512) {
      const entries = [...this.cache.entries()].sort((a, b) => a[1].at - b[1].at);
      for (let i = 0; i < 128; i += 1) {
        const entry = entries[i];
        if (entry) this.cache.delete(entry[0]);
      }
    }
    return results;
  }

  /**
   * Empties the cache. Exposed for tests + eventual "force refresh"
   * ops endpoint.
   */
  clearCache(): void {
    this.cache.clear();
  }

  private spendToken(): void {
    const now = Date.now();
    const elapsedS = (now - this.lastRefill) / 1000;
    const refill = Math.floor(elapsedS * this.qps);
    if (refill > 0) {
      this.tokens = Math.min(this.qps, this.tokens + refill);
      this.lastRefill = now;
    }
    if (this.tokens <= 0) {
      throw new TooManyRequestsException({
        code: 'GEOCODE_RATE_LIMITED',
        message: 'Address lookup is temporarily saturated. Try again in a moment.',
      });
    }
    this.tokens -= 1;
  }
}
