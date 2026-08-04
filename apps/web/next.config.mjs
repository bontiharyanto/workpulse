import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd = process.env.NODE_ENV === 'production';

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
  ...(isProd
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
