import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

/**
 * Fase 32e — SSRF hardening for outbound webhook URLs.
 *
 * Trust boundary: HR types the URL. We must not allow that URL to
 * become a lever for scanning internal services, hitting cloud
 * metadata endpoints (169.254.169.254), or exfiltrating traffic to
 * loopback.
 *
 * Validation is two-phase:
 *
 *   1. **Syntactic** (`validateUrlSyntax`) — pure, no DNS:
 *      - Only http / https schemes.
 *      - `https` mandatory in production.
 *      - No `userinfo` (`https://user:pass@host` is a common evasion).
 *      - No port pointing at obvious admin services (0, or well-known
 *        internal-only ones we can't guarantee anything about).
 *   2. **Resolved-IP** (`validateResolvedHost`) — DNS lookup + private
 *      range check. Skipped when `blockPrivateIps` is `false` (on-prem
 *      deployments explicitly opt out).
 *
 * The two-phase split matters: HR clicks "test" while onboarding, we
 * catch the mistake before enqueueing. The worker also re-validates
 * before each delivery so DNS rebinding attacks are caught even if the
 * hostname resolved cleanly at create-time.
 */

export type UrlIssue =
  | 'MALFORMED_URL'
  | 'INVALID_SCHEME'
  | 'HTTPS_REQUIRED'
  | 'CREDENTIALS_IN_URL'
  | 'BLOCKED_HOST'
  | 'DNS_LOOKUP_FAILED'
  | 'PRIVATE_IP';

export interface UrlValidation {
  ok: boolean;
  issues: UrlIssue[];
  parsed?: URL;
  resolvedIps?: string[];
}

/**
 * IPv4 ranges we always refuse: loopback, link-local, private,
 * multicast, "this network", CGNAT, and the AWS/GCP metadata IP.
 * IPv6: loopback, link-local, ULA, and IPv4-mapped equivalents.
 */
function isPrivateOrReservedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const parts = ip.split('.').map((x) => Number(x));
    const a = parts[0] ?? -1;
    const b = parts[1] ?? -1;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fe80:')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
    // ::ffff:<IPv4>
    if (lower.startsWith('::ffff:')) {
      return isPrivateOrReservedIp(lower.slice('::ffff:'.length));
    }
    if (lower.startsWith('ff')) return true; // multicast
    return false;
  }
  return false;
}

export interface SyntaxOptions {
  /** When true, only https:// URLs are accepted. */
  httpsRequired: boolean;
}

export function validateUrlSyntax(urlString: string, opts: SyntaxOptions): UrlValidation {
  const issues: UrlIssue[] = [];
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { ok: false, issues: ['MALFORMED_URL'] };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    issues.push('INVALID_SCHEME');
  }
  if (opts.httpsRequired && parsed.protocol !== 'https:') {
    issues.push('HTTPS_REQUIRED');
  }
  if (parsed.username || parsed.password) {
    issues.push('CREDENTIALS_IN_URL');
  }
  // Refuse the metadata IP literal even when private-ip blocking is
  // disabled — nobody needs to POST payroll data to the cloud metadata
  // endpoint.
  if (parsed.hostname === '169.254.169.254') {
    issues.push('BLOCKED_HOST');
  }
  return { ok: issues.length === 0, issues, parsed };
}

/**
 * Resolve the hostname and refuse if any A/AAAA record lies in a
 * private / reserved range. Uses `dns.lookup` (system resolver + hosts
 * file, matching how the worker will actually connect) rather than
 * `dns.resolve` (bypasses hosts file, could disagree with the
 * connect() call and open a TOCTOU gap).
 *
 * `blockPrivateIps=false` → skipped entirely (on-prem deployments).
 */
export async function validateResolvedHost(
  hostname: string,
  opts: { blockPrivateIps: boolean },
): Promise<UrlValidation> {
  if (!opts.blockPrivateIps) return { ok: true, issues: [] };

  // If the host is an IP literal, check it directly — no DNS involved.
  if (isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      return { ok: false, issues: ['PRIVATE_IP'], resolvedIps: [hostname] };
    }
    return { ok: true, issues: [], resolvedIps: [hostname] };
  }

  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    const ips = records.map((r) => r.address);
    if (ips.some(isPrivateOrReservedIp)) {
      return { ok: false, issues: ['PRIVATE_IP'], resolvedIps: ips };
    }
    return { ok: true, issues: [], resolvedIps: ips };
  } catch {
    return { ok: false, issues: ['DNS_LOOKUP_FAILED'] };
  }
}

/**
 * Convenience full-validate. Callers that don't want the two-phase
 * separation (i.e. an API request where DNS latency is fine) can call
 * this and be done.
 */
export async function validateUrl(
  urlString: string,
  opts: SyntaxOptions & { blockPrivateIps: boolean },
): Promise<UrlValidation> {
  const syntax = validateUrlSyntax(urlString, opts);
  if (!syntax.ok || !syntax.parsed) return syntax;
  const resolved = await validateResolvedHost(syntax.parsed.hostname, opts);
  if (!resolved.ok) {
    return {
      ok: false,
      issues: [...syntax.issues, ...resolved.issues],
      parsed: syntax.parsed,
      resolvedIps: resolved.resolvedIps,
    };
  }
  return {
    ok: true,
    issues: [],
    parsed: syntax.parsed,
    resolvedIps: resolved.resolvedIps,
  };
}
