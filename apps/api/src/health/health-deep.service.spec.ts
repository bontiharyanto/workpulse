import { ConfigService } from '@nestjs/config';

import type { EnvConfig } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import type { StorageProvider } from '../storage/storage.provider';

import { HealthDeepService } from './health-deep.service';

type ConfigServiceT = ConfigService<EnvConfig, true>;

describe('HealthDeepService', () => {
  function build(overrides: {
    dbFails?: boolean;
    storageEnabled?: boolean;
    storageOk?: boolean;
    envValues?: Record<string, unknown>;
  } = {}) {
    const {
      dbFails = false,
      storageEnabled = true,
      storageOk = true,
      envValues = {},
    } = overrides;

    const prisma = {
      $queryRaw: jest.fn(() =>
        dbFails ? Promise.reject(new Error('conn refused')) : Promise.resolve([{ '?column?': 1 }]),
      ),
    } as unknown as PrismaService;

    const storage: StorageProvider = {
      enabled: storageEnabled,
      presignPut: jest.fn(),
      presignGet: jest.fn(),
      putObject: jest.fn(),
      deleteObject: jest.fn(),
      healthCheck: jest.fn(async () =>
        storageOk
          ? { ok: true as const, latencyMs: 12 }
          : { ok: false as const, reason: 'NoSuchBucket:404', latencyMs: 8 },
      ),
    };

    const defaults: Record<string, unknown> = {
      NODE_ENV: 'test',
      SENTRY_RELEASE: 'v2026.08.03',
      DATA_EXPORT_WORKER_ENABLED: 'true',
      DATA_ERASURE_WORKER_ENABLED: 'true',
      RETENTION_WORKER_ENABLED: 'true',
      WEBHOOK_WORKER_ENABLED: 'true',
      TIMESHEET_SCHEDULER_ENABLED: 'true',
      ANALYTICS_SNAPSHOT_ENABLED: 'true',
      REPORT_SCHEDULER_ENABLED: 'true',
      BREACH_REMINDER_WORKER_ENABLED: 'true',
    };
    const merged = { ...defaults, ...envValues };

    const config = {
      get: (key: string) => merged[key],
    } as unknown as ConfigServiceT;

    return new HealthDeepService(prisma, storage, config);
  }

  it('returns ok when db + storage are healthy', async () => {
    const svc = build();
    const res = await svc.check();
    expect(res.status).toBe('ok');
    expect(res.checks.database.status).toBe('up');
    expect(res.checks.storage.status).toBe('up');
    expect(res.version.release).toBe('v2026.08.03');
    expect(res.workers.dataExport?.enabled).toBe(true);
  });

  it('returns down when database is unreachable (blocks traffic)', async () => {
    const svc = build({ dbFails: true });
    const res = await svc.check();
    expect(res.status).toBe('down');
    expect(res.checks.database.status).toBe('down');
    expect(res.checks.database.reason).toBeDefined();
  });

  it('returns degraded when storage is unreachable but db is fine', async () => {
    const svc = build({ storageOk: false });
    const res = await svc.check();
    expect(res.status).toBe('degraded');
    expect(res.checks.storage.status).toBe('down');
    expect(res.checks.storage.reason).toBe('NoSuchBucket:404');
    expect(res.checks.database.status).toBe('up');
  });

  it('marks storage as skipped when the provider is disabled', async () => {
    const svc = build({ storageEnabled: false });
    const res = await svc.check();
    expect(res.status).toBe('ok');
    expect(res.checks.storage.status).toBe('skipped');
  });

  it('reflects worker kill switches from env', async () => {
    const svc = build({
      envValues: {
        WEBHOOK_WORKER_ENABLED: 'false',
        TIMESHEET_SCHEDULER_ENABLED: 'false',
      },
    });
    const res = await svc.check();
    expect(res.workers.webhook?.enabled).toBe(false);
    expect(res.workers.timesheetScheduler?.enabled).toBe(false);
    expect(res.workers.dataExport?.enabled).toBe(true);
  });

  it('includes uptime and iso timestamp in the payload', async () => {
    const svc = build();
    const res = await svc.check();
    expect(Number.isInteger(res.uptimeSec)).toBe(true);
    expect(res.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(new Date(res.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('parallelises db + storage probes so total latency ≈ max(dep)', async () => {
    // If probes were serial, total time would be ~200ms. Parallel keeps it ~100ms.
    const slowDb = {
      $queryRaw: jest.fn(
        () => new Promise((resolve) => setTimeout(() => resolve([{ 1: 1 }]), 100)),
      ),
    } as unknown as PrismaService;

    const slowStorage: StorageProvider = {
      enabled: true,
      presignPut: jest.fn(),
      presignGet: jest.fn(),
      putObject: jest.fn(),
      deleteObject: jest.fn(),
      healthCheck: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ ok: true, latencyMs: 100 }), 100),
        ),
    };

    const config = { get: () => 'true' } as unknown as ConfigServiceT;
    const svc = new HealthDeepService(slowDb, slowStorage, config);

    const t0 = Date.now();
    const res = await svc.check();
    const elapsed = Date.now() - t0;
    expect(res.status).toBe('ok');
    // Allow slack for slow CI hardware — even 180ms proves we're parallel (< 200ms serial).
    expect(elapsed).toBeLessThan(180);
  });
});
