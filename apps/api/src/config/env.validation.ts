import { z } from 'zod';

export const envValidationSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_TIMEZONE: z.string().default('Asia/Jakarta'),

    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_URL: z.string().url().default('http://localhost:4000'),
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
    /** Public base URL of the web app — used to build password-reset links. */
    WEB_URL: z.string().url().default('http://localhost:3000'),

    DATABASE_URL: z.string().url(),
    SHADOW_DATABASE_URL: z.string().url().optional(),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
    JWT_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_ROOT: z.string().default('./storage/uploads'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    /** Full URL of the S3 endpoint. Set to `http://minio:9000` for MinIO in Docker. */
    S3_ENDPOINT: z.string().url().optional(),
    /** Force path-style URLs (required for MinIO). */
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),
    /** Presigned PUT TTL, seconds. Short = safer. */
    S3_PRESIGN_PUT_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    /** Presigned GET TTL, seconds. Long enough for HR to open attachments during review. */
    S3_PRESIGN_GET_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),

    // ---- Notifications ---------------------------------------------------------
    /**
     * Email transport for notification fan-out. `console` logs to stdout (dev),
     * `disabled` skips email entirely (in-app only), `smtp` uses nodemailer
     * (production — requires the SMTP_* vars below and the `nodemailer` package
     * to be installed at deploy time).
     */
    EMAIL_TRANSPORT: z.enum(['console', 'disabled', 'smtp']).default('console'),
    EMAIL_FROM: z.string().default('Workpulse <no-reply@workpulse.local>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    SMTP_SECURE: z.coerce.boolean().default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    /**
     * When `true`, `SmtpEmailAdapter` runs `transporter.verify()` at boot
     * and logs the result. Failures are warnings, not fatal — the app
     * still boots. Default `false` so a temporarily flaky provider does
     * not delay every fresh deploy.
     */
    SMTP_VERIFY_ON_BOOT: z.enum(['true', 'false']).default('false'),

    // ---- Security headers -----------------------------------------------------
    /**
     * Extra origins that the API allows in its Content-Security-Policy
     * `connect-src` / `img-src`. Comma-separated. Used when the API
     * serves the Swagger UI in non-prod and it needs to pull assets from
     * a CDN — keep empty in production.
     */
    API_CSP_EXTRA_ORIGINS: z.string().optional(),
    /**
     * When `true`, adds the `preload` directive to `Strict-Transport-Security`
     * and lengthens `max-age` to the value HSTS-preload requires
     * (63072000 = 2 years). Only flip this on for prod deploys behind
     * HTTPS with a valid cert on ALL subdomains — irreversible for browsers
     * that pick up the preload list.
     */
    HSTS_PRELOAD: z.enum(['true', 'false']).default('false'),

    // ---- Throttler bypass -----------------------------------------------------
    /**
     * Test-only escape hatch: when set to `"true"` the global `ThrottlerGuard`
     * returns `true` for every request. Used by the E2E harness to run dozens
     * of logins in seconds. Refuses to load with `NODE_ENV=production` — see
     * the `superRefine` below.
     */
    THROTTLER_DISABLED: z.enum(['true', 'false']).default('false'),

    // ---- MFA (Multi-Factor Authentication) ------------------------------------
    /**
     * 32-byte AES-256-GCM key encoded as base64 (44 chars). Used to encrypt
     * `User.mfaSecret` at rest. **MUST** be set in production — the API
     * refuses to boot when MFA endpoints are compiled but this key is
     * missing. Rotate by generating a new key, re-encrypting all
     * `mfaSecret` values via a migration, then swapping the env.
     */
    MFA_SECRET_ENCRYPTION_KEY: z
      .string()
      .regex(/^[A-Za-z0-9+/=]+$/, 'MFA_SECRET_ENCRYPTION_KEY must be base64')
      .refine((v) => {
        try {
          return Buffer.from(v, 'base64').length === 32;
        } catch {
          return false;
        }
      }, 'MFA_SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes')
      .optional(),
    /** Human-readable issuer shown in authenticator apps (e.g. "Workpulse"). */
    MFA_ISSUER: z.string().default('Workpulse'),
    /** Number of backup codes generated at enrollment / regeneration. */
    MFA_BACKUP_CODES_COUNT: z.coerce.number().int().min(4).max(20).default(8),
    /**
     * When `true`, HR_MANAGER + SUPER_ADMIN accounts that have not
     * enrolled MFA are gated with `MFA_ENROLLMENT_REQUIRED` on every
     * non-`/auth` endpoint. Default `true` — production posture.
     *
     * MVP policy: MFA is **opt-in** for every role. HR / Super Admin
     * can still enable MFA voluntarily via `/settings/security` and
     * `MfaVerifiedGuard` still challenges them at login — this flag
     * only controls whether enrollment is FORCED on their next
     * request. Set to `'true'` in a future hardening milestone once
     * ops has run a communications + support cycle with HR.
     *
     * The E2E harness leaves this at `'false'` for the same reason
     * dev does — the MFA enrollment scenarios explicitly toggle it
     * inside their own tests when they need to exercise the forced
     * path.
     */
    MFA_ENFORCE_HR_ADMIN: z.enum(['true', 'false']).default('false'),

    // ---- Observability --------------------------------------------------------
    /** pino log level. Lower = noisier. */
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    /**
     * Force pino-pretty output regardless of NODE_ENV. In dev this is on by
     * default; in production it should stay `false` so log-aggregators can
     * parse the JSON lines.
     */
    LOG_PRETTY: z.enum(['true', 'false']).default('false'),
    /** Sentry DSN. Leave empty to disable Sentry entirely. */
    SENTRY_DSN: z.string().optional(),
    /** Deployment tag surfaced in the Sentry UI. Defaults to `NODE_ENV`. */
    SENTRY_ENVIRONMENT: z.string().optional(),
    /** Release identifier — typically the git SHA or build ID. */
    SENTRY_RELEASE: z.string().optional(),
    /** Fraction of transactions to sample for performance. 0 disables tracing. */
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

    // ---- DSAR (Data Subject Access Request, Fase 31a) -------------------------
    /**
     * Cooldown in hours between two `POST /me/data-export` calls per
     * user. Belongs at the service layer (not the throttler) because
     * the window is 24 hours by default and not a burst limit.
     */
    DATA_EXPORT_COOLDOWN_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    /**
     * Kill switch for the background worker. When `false`, this API
     * instance keeps accepting new PENDING requests but does NOT
     * process them — assumed a separate node is running the worker.
     * Default `true` so a single-node deploy Just Works.
     */
    DATA_EXPORT_WORKER_ENABLED: z.enum(['true', 'false']).default('true'),

    // ---- Right-to-erasure (Fase 31b) -----------------------------------------
    /**
     * Days between HR / admin approval and the worker executing the
     * anonymisation. Purposely conservative — gives the user a chance
     * to walk it back. Bounded (1–30) so a misconfigured tenant cannot
     * effectively disable the feature by setting it to years.
     */
    DATA_ERASURE_GRACE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    /**
     * Kill switch for the erasure worker. When `false`, approved
     * requests will accumulate as APPROVED_SCHEDULED but never execute
     * on this API instance — assumes a separate node is running the
     * worker. Default `true` so a single-node deploy Just Works.
     */
    DATA_ERASURE_WORKER_ENABLED: z.enum(['true', 'false']).default('true'),

    /**
     * Kill switch for the retention worker (Fase 31c). Set to `false` on
     * follower replicas so only the primary node executes tenant-scoped
     * data-lifecycle sweeps.
     */
    RETENTION_WORKER_ENABLED: z.enum(['true', 'false']).default('true'),

    /**
     * OPS-6 — kill switch for the monthly retention audit worker. Cron
     * fires on day 1 of every month at 05:30 UTC (after the retention
     * sweep has had a chance to catch up) and generates an attestation
     * report per tenant. Disable on follower replicas.
     */
    RETENTION_AUDIT_WORKER_ENABLED: z.enum(['true', 'false']).default('true'),

    /**
     * OPS-7 — kill switch for the monthly tenant usage snapshot worker.
     * Cron fires on day 1 of every month at 06:00 UTC (after the audit)
     * and stamps per-tenant storage, DB row, email + webhook counters
     * into `TenantUsageSnapshot`. Disable on follower replicas.
     */
    TENANT_USAGE_WORKER_ENABLED: z.enum(['true', 'false']).default('true'),

    /**
     * Fase 31f — kill switch for the vendor / processor review reminder
     * worker. Cron fires daily at 07:00 UTC; for each tenant it scans
     * `VendorProcessor` and fires a `VENDOR_REVIEW_DUE` reminder when
     * `nextReviewAt` is within 30 days, or `VENDOR_CONTRACT_EXPIRING`
     * when `contractEndAt` is within 60 days. Dedup via
     * `VendorReminderLog`. Disable on follower replicas.
     */
    VENDOR_REVIEW_REMINDER_WORKER_ENABLED: z.enum(['true', 'false']).default('true'),

    // ---- Timesheet export sharing (Fase 32d) --------------------------------
    /**
     * Externally-reachable base URL of THIS API, without a trailing slash
     * and without the `/api/v1` suffix (added by the service). Used by
     * signed URL builders so vendors receive an absolute link. Falls back
     * to `http://localhost:4000` for local dev.
     */
    PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
    /**
     * HMAC-SHA256 signing secret used to mint & verify signed download
     * URLs for `TimesheetExport` rows (Fase 32d).
     *
     * At least 32 bytes of entropy. Generate with `openssl rand -base64 32`.
     * Rotating this secret invalidates every previously-issued link
     * immediately — that's the point: if a URL is leaked, rotate.
     *
     * Optional in dev (a random value is generated at boot); mandatory in
     * production (see `superRefine` below).
     */
    TIMESHEET_EXPORT_SIGNING_SECRET: z
      .string()
      .min(32, 'TIMESHEET_EXPORT_SIGNING_SECRET must be at least 32 chars')
      .optional(),
    /**
     * Default lifetime of a signed download URL in hours. HR can shorten
     * it per-share when creating the link. Bounded 1 – 168 (1 week) so
     * an operator misconfiguration cannot mint effectively-permanent
     * links.
     */
    TIMESHEET_EXPORT_SHARE_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),

    // ---- Outbound webhooks (Fase 32e) ---------------------------------------
    /**
     * Kill switch for the delivery worker. `false` on follower replicas
     * so only the primary node dispatches HTTP. Default `true` for
     * single-node deployments.
     */
    WEBHOOK_WORKER_ENABLED: z.enum(['true', 'false']).default('true'),
    /**
     * Per-request HTTP timeout in ms. Aggressive so a slow endpoint can't
     * pin worker threads. Bounded so an operator misconfiguration can't
     * effectively DoS the worker.
     */
    WEBHOOK_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
    /**
     * Max delivery attempts per event. Fixed schedule 30s / 5m / 30m / 6h
     * (see WebhookWorker), so 4 attempts covers a ~6.5-hour retry window
     * before we mark FAILED and stop trying.
     */
    WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
    /**
     * When `true`, block outbound webhook URLs whose host resolves to a
     * loopback / private / link-local IP (SSRF hardening). Default `true`
     * in production; opt out only for on-prem deployments where the
     * payroll system lives on the same private network.
     */
    WEBHOOK_BLOCK_PRIVATE_IPS: z.enum(['true', 'false']).default('true'),

    // ---- Timesheet scheduler (Fase 32f) ------------------------------------
    /**
     * Kill switch for the timesheet auto-generation + reminder worker.
     * `false` on follower replicas so only the primary node runs the
     * daily sweep. Default `true`.
     */
    TIMESHEET_SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true'),

    // ---- Analytics snapshot (Fase 33a) --------------------------------------
    /**
     * Kill switch for the nightly executive-KPI snapshot worker. `false`
     * on follower replicas so only the primary node materialises rows into
     * `AnalyticsSnapshot`. The dashboard endpoint keeps serving from the
     * table regardless of this flag — reads are always safe. Default `true`.
     */
    ANALYTICS_SNAPSHOT_ENABLED: z.enum(['true', 'false']).default('true'),
    REPORT_SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true'),
    /**
     * Fase 31g — Breach Notification Ledger deadline reminder cron
     * (fires every 5 minutes). Set to `false` on follower replicas so
     * only one instance dispatches T-24h / T-4h / OVERDUE reminders.
     * The ledger endpoints keep serving regardless of this flag —
     * reads/writes to `BreachIncident` are always safe. Default `true`.
     */
    BREACH_REMINDER_WORKER_ENABLED: z.enum(['true', 'false']).default('true'),

    // ---- Self-hosted maps (ADR-0042, Track 3) --------------------------------
    /**
     * Master kill switch for the `/maps/*` module. When `false`, every
     * map endpoint returns 503 `MAPS_DISABLED` — used for the phased
     * rollout described in ADR-0042 §Rollout plan (Phase 1 ships the
     * code disabled; Phase 2 ops flips this to `true` after seeding
     * the `MAPS_TILES_BUCKET`). Default `false` so a fresh deploy
     * does not render broken maps to end users.
     */
    MAPS_ENABLED: z.enum(['true', 'false']).default('false'),
    /**
     * Name of the MinIO / S3 bucket holding the PMTiles archive +
     * glyphs + sprites. Kept separate from `S3_BUCKET` (attachments)
     * so the two have independent retention / rotation stories.
     */
    MAPS_TILES_BUCKET: z.string().default('workpulse-maptiles'),
    /**
     * Object key of the PMTiles archive inside `MAPS_TILES_BUCKET`.
     * Ops swaps this key when publishing a new archive (typical
     * pattern: upload `indonesia.2026-08.pmtiles` alongside the
     * live one, verify, then repoint this env — atomic switch).
     */
    MAPS_PMTILES_KEY: z.string().default('indonesia.pmtiles'),
    /**
     * Prefix for the PBF glyphs directory in the bucket. Ends with
     * `/`. Requests to `/maps/glyphs/{fontstack}/{range}.pbf` are
     * translated to `<prefix>{fontstack}/{range}.pbf`.
     */
    MAPS_GLYPHS_PREFIX: z.string().default('glyphs/'),
    /**
     * Prefix for the sprite directory in the bucket. Ends with `/`.
     * Requests to `/maps/sprites/{name}.{ext}` map to
     * `<prefix>{name}.{ext}`.
     */
    MAPS_SPRITES_PREFIX: z.string().default('sprites/'),
    /**
     * Upstream Nominatim base URL for `/maps/geocode`. Defaults to
     * the public OSM service. Rebrand-worthy — some tenants may
     * front their own geocoder here. `getForCompany`-style
     * per-tenant overrides are out of scope for this ADR.
     */
    MAPS_GEOCODE_UPSTREAM: z
      .string()
      .url()
      .default('https://nominatim.openstreetmap.org'),
    /**
     * `User-Agent` string sent to the geocoder upstream. Required
     * by Nominatim's AUP — anonymous requests are throttled or
     * blocked. Include a contact email so upstream ops can reach
     * us if we cause a problem.
     */
    MAPS_GEOCODE_USER_AGENT: z.string().default('Workpulse/1.0'),
    /**
     * Max queries per second the API sends to the upstream geocoder.
     * Default `1` matches Nominatim's AUP; raise when self-hosting
     * or using a paid geocoder that allows more.
     */
    MAPS_GEOCODE_QPS: z.coerce.number().int().min(1).max(50).default(1),
    /**
     * TTL for the in-memory geocode result cache. Aggressive default
     * (24h) because address lookups are highly cacheable and the
     * cost of a stale result is very low.
     */
    MAPS_GEOCODE_CACHE_TTL_S: z.coerce.number().int().min(60).max(604_800).default(86_400),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.THROTTLER_DISABLED === 'true') {
      ctx.addIssue({
        code: 'custom',
        path: ['THROTTLER_DISABLED'],
        message: 'THROTTLER_DISABLED=true is not allowed with NODE_ENV=production',
      });
    }
    if (env.NODE_ENV === 'production' && !env.MFA_SECRET_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['MFA_SECRET_ENCRYPTION_KEY'],
        message:
          'MFA_SECRET_ENCRYPTION_KEY is required in production. Generate with `openssl rand -base64 32`.',
      });
    }
    // NOTE: previously we refused `MFA_ENFORCE_HR_ADMIN=false` in
    // production. That's been relaxed for MVP — MFA is opt-in
    // regardless of NODE_ENV. When we re-tighten policy (see ADR-0017
    // "Future work"), restore a superRefine block here that gates the
    // `false` value behind a `MFA_ENFORCE_OVERRIDE_ACK=true` opt-out
    // env, so a copy-paste accident can't silently disable MFA in prod.
    if (env.NODE_ENV === 'production' && !env.TIMESHEET_EXPORT_SIGNING_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['TIMESHEET_EXPORT_SIGNING_SECRET'],
        message:
          'TIMESHEET_EXPORT_SIGNING_SECRET is required in production. Generate with `openssl rand -base64 32`.',
      });
    }
    if (env.EMAIL_TRANSPORT === 'smtp') {
      if (!env.SMTP_HOST) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_HOST'],
          message: 'SMTP_HOST is required when EMAIL_TRANSPORT=smtp',
        });
      }
      if (!env.SMTP_PORT) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_PORT'],
          message: 'SMTP_PORT is required when EMAIL_TRANSPORT=smtp',
        });
      }
    }
    if (env.NODE_ENV === 'production' && env.EMAIL_TRANSPORT !== 'smtp') {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_TRANSPORT'],
        message: 'EMAIL_TRANSPORT must be `smtp` in production (console/disabled are dev-only).',
      });
    }
  });

export type EnvConfig = z.infer<typeof envValidationSchema>;
