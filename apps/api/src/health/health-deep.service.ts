import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvConfig } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage/storage.provider';

export type DependencyStatus = 'up' | 'down' | 'skipped';

export interface DeepCheckResult {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptimeSec: number;
  version: {
    nodeEnv: string;
    release: string | null;
  };
  checks: {
    database: { status: DependencyStatus; latencyMs: number; reason?: string };
    storage: { status: DependencyStatus; latencyMs: number; reason?: string };
  };
  workers: Record<string, { enabled: boolean }>;
}

/**
 * Aggregates cheap dependency probes so on-call has one endpoint to hit.
 *
 * Every probe MUST be:
 *  - Bounded in wall-time (default budget 3s per dep).
 *  - Safe under concurrent invocation (Sentry cron / external monitor may
 *    hammer the endpoint every 30s).
 *  - Deterministic — same inputs → same outputs. No side effects.
 *
 * Escalation rule for `status`:
 *  - `down`      → HTTP 503, page on-call (database unreachable).
 *  - `degraded`  → HTTP 503, warn but do not page (storage down means new
 *                  attachments fail but the app keeps serving reads).
 *  - `ok`        → HTTP 200.
 */
@Injectable()
export class HealthDeepService {
  private readonly logger = new Logger(HealthDeepService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async check(): Promise<DeepCheckResult> {
    const [database, storage] = await Promise.all([
      this.checkDatabase(),
      this.checkStorage(),
    ]);

    const overall: DeepCheckResult['status'] = (() => {
      if (database.status === 'down') return 'down';
      if (storage.status === 'down') return 'degraded';
      return 'ok';
    })();

    return {
      status: overall,
      timestamp: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      version: {
        nodeEnv: this.config.get('NODE_ENV', { infer: true }) ?? 'unknown',
        release: this.config.get('SENTRY_RELEASE', { infer: true }) ?? null,
      },
      checks: {
        database,
        storage,
      },
      workers: this.workerStatus(),
    };
  }

  private async checkDatabase(): Promise<DeepCheckResult['checks']['database']> {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'up', latencyMs: Date.now() - started };
    } catch (err) {
      this.logger.error(`database probe failed: ${(err as Error).message}`);
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        reason: (err as Error).name ?? 'unknown',
      };
    }
  }

  private async checkStorage(): Promise<DeepCheckResult['checks']['storage']> {
    if (!this.storage.enabled) {
      return { status: 'skipped', latencyMs: 0, reason: 'storage_disabled' };
    }
    const result = await this.storage.healthCheck();
    if (result.ok) {
      return { status: 'up', latencyMs: result.latencyMs };
    }
    return {
      status: 'down',
      latencyMs: result.latencyMs,
      reason: result.reason,
    };
  }

  /**
   * Kill-switch status per background worker. Purely informational so the
   * ops team can see at a glance which workers are supposed to be doing
   * their thing on this instance. Does NOT prove the worker is actually
   * ticking — for that, use the `last-run` markers exposed by each worker
   * (data-export, retention, timesheet-scheduler, webhook, breach reminder).
   */
  private workerStatus(): DeepCheckResult['workers'] {
    const flag = (key: keyof EnvConfig, fallback = true): boolean => {
      const raw = this.config.get(key, { infer: true });
      if (raw === undefined || raw === null || raw === '') return fallback;
      if (typeof raw === 'boolean') return raw;
      return String(raw).toLowerCase() === 'true';
    };

    return {
      dataExport: { enabled: flag('DATA_EXPORT_WORKER_ENABLED') },
      dataErasure: { enabled: flag('DATA_ERASURE_WORKER_ENABLED') },
      retention: { enabled: flag('RETENTION_WORKER_ENABLED') },
      retentionAudit: { enabled: flag('RETENTION_AUDIT_WORKER_ENABLED') },
      tenantUsage: { enabled: flag('TENANT_USAGE_WORKER_ENABLED') },
      webhook: { enabled: flag('WEBHOOK_WORKER_ENABLED') },
      timesheetScheduler: { enabled: flag('TIMESHEET_SCHEDULER_ENABLED') },
      analyticsSnapshot: { enabled: flag('ANALYTICS_SNAPSHOT_ENABLED') },
      reportScheduler: { enabled: flag('REPORT_SCHEDULER_ENABLED') },
      breachReminder: { enabled: flag('BREACH_REMINDER_WORKER_ENABLED') },
      vendorReviewReminder: {
        enabled: flag('VENDOR_REVIEW_REMINDER_WORKER_ENABLED'),
      },
    };
  }
}
