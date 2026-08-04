/**
 * Sentry bootstrap.
 *
 * This module is imported by `main.ts` BEFORE anything else so that Sentry's
 * OpenTelemetry-based auto-instrumentation can wrap Node internals (http,
 * express, prisma) before those modules are required elsewhere. See
 * https://docs.sentry.io/platforms/javascript/guides/nestjs/#configure
 *
 * If `SENTRY_DSN` is not set (typical for local dev), `init()` is a no-op —
 * subsequent `Sentry.captureException` calls simply do nothing.
 */
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;

if (dsn && dsn.length > 0) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
    // Drop routine 4xx client errors — those are business validation, not
    // production bugs worth paging on. Anything 5xx or non-HTTP still flows.
    beforeSend(event, hint) {
      const err = hint?.originalException as { status?: number; getStatus?: () => number } | null;
      const status = typeof err?.getStatus === 'function' ? err.getStatus() : err?.status;
      if (typeof status === 'number' && status >= 400 && status < 500) return null;
      return event;
    },
  });
}
