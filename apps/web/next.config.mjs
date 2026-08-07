import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd = process.env.NODE_ENV === 'production';

/**
 * HSTS must ONLY be emitted when the deployment is actually served
 * over HTTPS. Emitting `Strict-Transport-Security` from an `http://`
 * origin causes Chrome to cache the origin as HSTS for 180 days —
 * subsequent requests are then force-upgraded to HTTPS, which fails
 * against a plain HTTP server (all script/img/font requests get
 * "blocked" in DevTools). This is why `NODE_ENV` alone is the wrong
 * gate: a production build served locally over HTTP is still HTTP.
 *
 * We derive the scheme from the `WEB_URL` env var which is the
 * canonical, deployment-configured public URL of the app.
 */
const isHttpsDeployment = (process.env.WEB_URL ?? '').startsWith('https://');

/*
 * Non-CSP security headers. CSP itself is emitted per-request by
 * `middleware.ts` because it embeds a fresh nonce, but static headers
 * (HSTS, X-Frame-Options, Permissions-Policy, …) sit here so they
 * also cover `/_next/*` static assets that the middleware matcher
 * explicitly excludes.
 */
const staticSecurityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    // Explicitly deny sensor / camera / mic / payment APIs — the app
    // does not use them (geolocation is user-triggered from
    // `navigator.geolocation` on `/attendance` and is not gated by
    // Permissions-Policy). Keep `geolocation=(self)` so the clock-in
    // flow still works.
    value: [
      'accelerometer=()',
      'autoplay=()',
      'camera=()',
      'display-capture=()',
      'fullscreen=(self)',
      'geolocation=(self)',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'midi=()',
      'payment=()',
      'usb=()',
    ].join(', '),
  },
  ...(isProd && isHttpsDeployment
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=15552000; includeSubDomains',
        },
      ]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@workpulse/shared-types'],
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Hide the floating "N" dev badge (Next.js dev tools indicator) so it
  // does not overlap the topbar avatar / notification bell during
  // demos & UAT. Prod builds never render it.
  devIndicators: false,
  experimental: {
    typedRoutes: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: staticSecurityHeaders,
      },
    ];
  },
};

export default nextConfig;
