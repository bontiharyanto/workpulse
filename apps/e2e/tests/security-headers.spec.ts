import { expect, request, test } from '@playwright/test';

/**
 * Fase 30c — Security-headers smoke test.
 *
 * Assert that the API AND the web app emit the expected hardening
 * headers. This is a smoke test — we do NOT try to lint the full CSP
 * value (Playwright is not a CSP parser); we check that specific,
 * high-signal directives are present.
 */

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3000';

test.describe('API — Helmet policy', () => {
  test('emits strict CSP, X-Frame-Options DENY, and no-referrer', async () => {
    const ctx = await request.newContext({ baseURL: API_URL });
    try {
      // Any endpoint will do — pick one that never triggers auth
      // work so this stays hermetic.
      const res = await ctx.get('/api/v1/health');
      expect(res.status()).toBeLessThan(500);

      const headers = res.headers();
      expect(headers['content-security-policy']).toBeDefined();

      const csp = headers['content-security-policy'] ?? '';
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      // NO 'unsafe-inline' in script-src.
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);

      expect(headers['x-frame-options']?.toLowerCase()).toBe('deny');
      expect(headers['referrer-policy']).toBe('no-referrer');
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-powered-by']).toBeUndefined();
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe('Web — Next.js hardening', () => {
  test('emits nonce-based CSP + strict Permissions-Policy on HTML routes', async () => {
    const ctx = await request.newContext({ baseURL: WEB_URL });
    try {
      const res = await ctx.get('/login');
      expect(res.status()).toBeLessThan(500);
      const headers = res.headers();

      const csp = headers['content-security-policy'] ?? '';
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      // Nonce must be present — format: `'nonce-<base64>'`.
      expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/);
      // `strict-dynamic` is set so nonce-loaded scripts can hydrate.
      expect(csp).toContain("'strict-dynamic'");

      expect(headers['x-frame-options']?.toLowerCase()).toBe('deny');
      expect(headers['referrer-policy']).toBe('no-referrer');
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-powered-by']).toBeUndefined();

      const permPolicy = headers['permissions-policy'] ?? '';
      expect(permPolicy).toContain('camera=()');
      expect(permPolicy).toContain('microphone=()');
      // Geolocation is opt-in for the clock-in flow — must NOT be
      // fully denied.
      expect(permPolicy).toContain('geolocation=(self)');
    } finally {
      await ctx.dispose();
    }
  });

  test('each request rotates the CSP nonce', async () => {
    const ctx = await request.newContext({ baseURL: WEB_URL });
    try {
      const [a, b] = await Promise.all([ctx.get('/login'), ctx.get('/login')]);
      const nonceA = /script-src [^;]*'nonce-([A-Za-z0-9+/=]+)'/.exec(
        a.headers()['content-security-policy'] ?? '',
      )?.[1];
      const nonceB = /script-src [^;]*'nonce-([A-Za-z0-9+/=]+)'/.exec(
        b.headers()['content-security-policy'] ?? '',
      )?.[1];
      expect(nonceA).toBeDefined();
      expect(nonceB).toBeDefined();
      expect(nonceA).not.toBe(nonceB);
    } finally {
      await ctx.dispose();
    }
  });
});
