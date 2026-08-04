# ADR-0027 — Outbound webhooks (Fase 32e)

## Status
Accepted — 2026-08-03.

## Context

Fase 32c/32d gave HR audited CSV/XLSX exports and signed share URLs. The
payroll integration still requires HR to eyeball a dashboard, download a
file, and hand it to the vendor. Two things drop out of that manual loop:

- **Latency.** Vendors expect to know within seconds when a new export
  lands. HR moving files around by hand is a floor of minutes to hours.
- **Repeatability.** BI teams asked for the same event stream to feed a
  reporting pipeline. Doubling up the manual step is untenable.

We want a fire-and-forget event bus that:

- Pushes to any HTTPS endpoint the tenant configures.
- Proves authenticity with a per-endpoint HMAC secret.
- Retries on transient failures without operator input.
- Is auditable — every attempt is logged with response status + snippet.
- Cannot be turned into an SSRF lever against internal services.

## Decision

### 1. Event set for Fase 32e

Two events, scoped tightly to the payroll integration path:

- `timesheet.export.created` — HR ran an export commit.
- `timesheet.export.share.created` — HR minted a signed download URL.
  Payload includes the URL itself so the vendor can auto-pull.

`share.revoked` and `timesheet.approved` are deferred (out of scope).

### 2. Data model

Two new tables (Prisma):

- `WebhookEndpoint` — one row per tenant subscription. Stores the URL,
  description, subscribed events, `secretCipher` (AES-256-GCM,
  base64-bundled, keyed by `MFA_SECRET_ENCRYPTION_KEY` for symmetry
  with MFA — same encryption key policy, same rotation posture),
  `active` flag, and per-endpoint failure counters.
- `WebhookDelivery` — append-only per-attempt log. Retry attempts mutate
  `status`, `attemptCount`, `nextAttemptAt`, `lastResponseStatus`,
  `lastResponseBodySnippet`, `lastError`, `signatureHeader`, and
  `deliveredAt`, but the frozen `payloadJson` never changes across
  attempts. `REVOKE DELETE ON TABLE` enforces immutability of history.

A unique index on `(endpointId, eventType, sourceId)` gives the
dispatcher a natural idempotency key — a re-run of the same source
event is a no-op on the second call, not a duplicate delivery.

### 3. Signature scheme

Stripe-style detached signature:

```
X-Workpulse-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256>
signed string = `${t}.${rawBody}`
```

The vendor:

1. Parses `t` and `v1`.
2. Rejects if `|now - t| > 5m` (tolerance is theirs — we recommend
   5m).
3. Recomputes HMAC with their stored secret and constant-time compares.

**Signing at delivery-time, not enqueue-time.** Postgres `jsonb` does
not preserve key order, so `JSON.stringify(row.payloadJson)` in the
worker is not byte-identical to what the dispatcher stringified. Signing
at delivery time makes the transport format the source of truth,
matches Stripe's design, and lets vendors keep a tight tolerance window
even across long retry chains. `signatureHeader` still lives on the
delivery row so operators can trace exactly what the vendor received
on the winning attempt.

### 4. Retry policy — fixed schedule

Fixed 30 s → 5 min → 30 min → 6 h (`WEBHOOK_MAX_ATTEMPTS=4` default).
Deterministic vs. exponential-with-jitter because:

- Payroll integrations are low-volume; jitter is only useful when
  fanning out to many followers.
- Operators want a predictable "if it hasn't succeeded in ~6.5 h it
  never will" ceiling.
- The four slots line up with human-timescale escalation (same shift,
  coffee break, between meetings, next business day).

Once retries are exhausted the row goes `FAILED` and stays there.
Operators can manually re-fire via the admin UI's "test-fire" button
if a vendor comes back online later.

### 5. SSRF hardening

Two-phase URL validation:

1. **Syntactic** (pure): only `http` / `https`, `https` required in
   production, no `userinfo`, explicit block of the AWS/GCP metadata
   literal `169.254.169.254`.
2. **Resolved-IP**: DNS lookup + refuse if any A/AAAA record lands in a
   private / reserved range (10/8, 127/8, 169.254/16, 172.16/12,
   192.168/16, 100.64/10 CGNAT, all-multicast, IPv6 loopback / ULA /
   link-local).

Both phases run at create-time (fast failure for HR) AND at each
delivery attempt (DNS rebinding defence). `WEBHOOK_BLOCK_PRIVATE_IPS`
can be `false` for on-prem deployments where the vendor lives on the
same private network — the E2E suite sets it explicitly.

Additional network hardening in the worker itself:

- `fetch(..., { redirect: 'error' })` — refuse 3xx (a redirect to
  `127.0.0.1` would trivially bypass the resolve-check).
- Per-request `AbortController` with `WEBHOOK_HTTP_TIMEOUT_MS` (default
  10 s) so a slow vendor cannot pin worker resources.
- User-Agent `Workpulse-Webhooks/1.0` — makes tenant logs discoverable
  from the vendor side.

### 6. Delivery worker

Cron every 30 s. Claim step uses `SELECT ... FOR UPDATE SKIP LOCKED`
in a `$queryRaw` block so multiple API replicas can run the worker
concurrently. Deliberately sequential per-tick (one endpoint at a
time) — for tenants with many endpoints we upscale the batch size, not
concurrency, to keep FD pressure bounded.

`WEBHOOK_WORKER_ENABLED=false` on follower replicas lets operators
pin delivery to the primary node.

### 7. Admin surface

`/admin/webhooks` page (HR / Super Admin only):

- Create form (URL, description, events checkbox).
- Endpoint list with test-fire, rotate-secret, toggle-active, delete.
- Rolling delivery log with 5 s auto-refresh.
- Secret plaintext returned ONCE at create + on rotate; never again.

### 8. Audit events

- `WEBHOOK_ENDPOINT_CREATED` — HR added a subscription.
- `WEBHOOK_ENDPOINT_UPDATED` — URL / events / active toggled.
- `WEBHOOK_ENDPOINT_SECRET_ROTATED` — HR rotated.
- `WEBHOOK_ENDPOINT_DELETED` — HR removed.
- Delivery attempts do not write to `AuditLog` — the `WebhookDelivery`
  row IS the audit record for the transport itself, keyed off the
  source entity id so cross-reference from the audit trail is a single
  query away.

## Consequences

**Positive.**

- Payroll vendors receive events within a delivery-worker tick (≤30 s).
- SSRF surface is closed by two-phase URL validation + `redirect:
  'error'` + explicit metadata-IP block.
- Secrets are AES-256-GCM at rest, reusing the MFA-crypto module so
  operators have one key to rotate.
- Delivery log is append-only + database-enforced immutability — the
  vendor cannot claim "we never got it" without contradicting the
  audit row.

**Negative.**

- Adds an outbound-HTTP failure mode to the API. Bounded by
  `WEBHOOK_HTTP_TIMEOUT_MS` and the sequential batch, but a slow
  vendor now costs 10 s of worker time per delivery.
- Postgres `jsonb` key-reordering forced sign-at-delivery, so retries
  do not have byte-identical signatures. The payload itself IS frozen
  and the delivery `id` is stable, so vendors can still de-duplicate by
  `x-workpulse-delivery-id`.
- Storing the plaintext secret is not possible after the initial
  create response — HR must paste it into the vendor system on the
  spot. This is a known usability tradeoff for the security posture.

## Related

- Fase 32c — ADR-0025 (payroll CSV / XLSX export).
- Fase 32d — ADR-0026 (signed share URL for payroll download).
- MFA — `apps/api/src/auth/mfa/domain/crypto.ts` (AES-256-GCM helper
  reused for webhook secrets).
