import { NextResponse, type NextRequest } from 'next/server';

/**
 * Fase 30c — Content Security Policy with per-request nonce.
 *
 * Next.js inlines a bootstrapping `<script>` on every server-rendered
 * page (RSC hydration state, flight payloads). To keep `script-src`
 * strict WITHOUT `'unsafe-inline'`, we generate a random 128-bit
 * nonce per request, stuff it into a request header that Next reads
 * when rendering, and mirror it into the `Content-Security-Policy`
 * header on the response.
 *
 * The `x-nonce` request header is picked up by Next.js automatically
 * for its own inline bootstrap scripts (see the framework's CSP
 * documentation for the contract). Any inline `<script>` authored in
 * the app must attach the same nonce — we expose it via
 * `getCurrentNonce()` for server components that need it.
 *
 * Non-page assets (static files, `/_next/image`, etc.) are excluded
 * via the `matcher` at the bottom so we do not spend the crypto RNG
 * on every image request.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const isProd = process.env.NODE_ENV === 'production';
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

  const csp = buildCsp({ nonce, isProd, apiUrl });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Forward the assembled CSP to server components so they can read it
  // if they need to fingerprint the nonce for a downstream `<Script>`.
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

function generateNonce(): string {
  // 128 bits of randomness is plenty (Google's CSP guidance calls for
  // >= 128 bits). Base64-encode to keep the header short.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function buildCsp(opts: {
  nonce: string;
  isProd: boolean;
  apiUrl: string;
}): string {
  const self = "'self'";
  const nonceSource = `'nonce-${opts.nonce}'`;
  // `strict-dynamic` lets any nonce-loaded script transitively load
  // additional scripts *without* needing host allowlists. It's the
  // modern, best-practice CSP shape. In dev we relax it because
  // Next.js's HMR runtime loads scripts via `eval`, which
  // strict-dynamic alone would still block.
  const scriptSrc = opts.isProd
    ? [nonceSource, "'strict-dynamic'"]
    : [nonceSource, "'strict-dynamic'", "'unsafe-eval'"];

  const directives: Record<string, string[] | undefined> = {
    'default-src': [self],
    'base-uri': [self],
    'font-src': [self, 'data:'],
    'form-action': [self],
    'frame-ancestors': ["'none'"],
    'img-src': [self, 'data:', 'blob:'],
    'object-src': ["'none'"],
    // Style is kept `'unsafe-inline'` because Tailwind emits many
    // small inline `style` attributes at build time and Next's dev
    // mode injects a raw `<style>` block. Tightening this needs a
    // build-side hash pipeline — deferred.
    'style-src': [self, "'unsafe-inline'"],
    'script-src': scriptSrc,
    'connect-src': [self, opts.apiUrl, ...(opts.isProd ? [] : ['ws:'])],
    'manifest-src': [self],
    ...(opts.isProd ? { 'upgrade-insecure-requests': [] } : {}),
  };

  return Object.entries(directives)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (v && v.length > 0 ? `${k} ${v.join(' ')}` : k))
    .join('; ');
}

/**
 * Restrict the middleware to routes that actually render HTML pages.
 * Static assets, Next's build files, and the favicon do not need
 * (and would be broken by) a CSP that references their own nonce.
 */
export const config = {
  matcher: [
    // Anything except:
    //   - _next/static (static assets)
    //   - _next/image  (next/image optimisation)
    //   - favicon.ico  (icon)
    //   - static files served from /public (svg, png, …)
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf|eot|json)$).*)',
  ],
};
