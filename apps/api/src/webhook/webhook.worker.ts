import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Prisma, WebhookDelivery, WebhookEndpoint } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { planNextAttempt } from './domain/retry-schedule';
import { validateResolvedHost, validateUrlSyntax } from './domain/url-guard';
import { sign } from './domain/webhook-signature';
import { WebhookService } from './webhook.service';

/**
 * Fase 32e — outbound HTTP worker.
 *
 * ## Loop shape
 *
 *   Every 30s (only one tick concurrent per instance):
 *   1. Claim up to `BATCH_SIZE` pending rows via
 *      `SELECT ... FOR UPDATE SKIP LOCKED`. Other replicas pick
 *      different rows. Crashing rolls back the claim so the row
 *      re-appears on the next tick.
 *   2. For each claimed row: re-validate the endpoint URL (DNS
 *      rebinding defence), POST the frozen payload with the frozen
 *      signature header, record the outcome.
 *   3. Success → `SUCCEEDED`, bump `lastSuccessAt`, reset
 *      `consecutiveFailures`.
 *   4. Failure → `planNextAttempt`. If retries exhausted → `FAILED`,
 *      else keep `PENDING` with a new `nextAttemptAt`.
 *
 * ## Signature timing
 *
 * We sign at delivery time (not enqueue), so `t=` in the header always
 * reflects the actual send moment. This lets vendors enforce a tight
 * (5-minute) tolerance window without special-casing retries. The
 * payload itself is frozen at enqueue-time (audit invariant), so a
 * vendor that sees a duplicate `id` on retry knows the byte content is
 * identical even if the signature/timestamp differ.
 */
@Injectable()
export class WebhookWorker {
  private readonly logger = new Logger(WebhookWorker.name);
  private readonly enabled: boolean;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly blockPrivateIps: boolean;
  private readonly httpsRequired: boolean;
  private tickRunning = false;

  /** How many rows per tick. Small to bound tail-latency + DB load. */
  private static readonly BATCH_SIZE = 25;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhookService: WebhookService,
    config: ConfigService,
  ) {
    this.enabled =
      config.get<string>('WEBHOOK_WORKER_ENABLED', 'true') !== 'false';
    this.timeoutMs = Number(
      config.get<number>('WEBHOOK_HTTP_TIMEOUT_MS', 10_000),
    );
    this.maxAttempts = Number(
      config.get<number>('WEBHOOK_MAX_ATTEMPTS', 4),
    );
    this.blockPrivateIps =
      config.get<string>('WEBHOOK_BLOCK_PRIVATE_IPS', 'true') !== 'false';
    this.httpsRequired =
      config.get<string>('NODE_ENV', 'development') === 'production';
    if (!this.enabled) {
      this.logger.warn(
        'WEBHOOK_WORKER_ENABLED=false — this API instance will NOT deliver webhooks.',
      );
    }
  }

  @Cron('*/30 * * * * *', { name: 'webhook-delivery-tick' })
  async tick(): Promise<void> {
    if (!this.enabled || this.tickRunning) return;
    this.tickRunning = true;
    try {
      const claimed = await this.claim();
      if (claimed.length === 0) return;
      // Sequential so a slow vendor doesn't fan out worker → server
      // FD pressure. For tenants with many endpoints, upscale
      // BATCH_SIZE, not concurrency.
      for (const row of claimed) {
        await this.deliverOne(row.delivery, row.endpoint);
      }
    } catch (err) {
      this.logger.error(
        `webhook worker tick crashed: ${(err as Error).message}`,
      );
    } finally {
      this.tickRunning = false;
    }
  }

  private async claim(): Promise<
    Array<{ delivery: WebhookDelivery; endpoint: WebhookEndpoint }>
  > {
    // Use a raw SELECT ... FOR UPDATE SKIP LOCKED to atomically pick
    // rows; the follow-up findMany with include hydrates them.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "WebhookDelivery"
        WHERE "status" = 'PENDING'
          AND "nextAttemptAt" <= now()
        ORDER BY "nextAttemptAt" ASC
        LIMIT ${WebhookWorker.BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      // Mark them as claimed by bumping nextAttemptAt into the future
      // so a concurrent tick on another replica can't grab the same
      // row after we release the FOR UPDATE lock. Success/failure will
      // rewrite this anyway.
      await tx.webhookDelivery.updateMany({
        where: { id: { in: ids } },
        data: { nextAttemptAt: new Date(Date.now() + 5 * 60_000) },
      });
      return ids;
    });
    if (claimed.length === 0) return [];
    const withEndpoints = await this.prisma.webhookDelivery.findMany({
      where: { id: { in: claimed } },
      include: { endpoint: true },
    });
    return withEndpoints.map((d) => ({
      delivery: d,
      endpoint: d.endpoint,
    }));
  }

  private async deliverOne(
    delivery: WebhookDelivery,
    endpoint: WebhookEndpoint,
  ): Promise<void> {
    if (!endpoint.active) {
      // Endpoint was flipped off after enqueue — mark FAILED with no
      // more retries, but audit-log this so operators can see why the
      // event never landed.
      await this.markPermanentlyFailed(delivery.id, 'endpoint disabled after enqueue');
      return;
    }

    // Re-validate the URL each attempt so DNS rebinding attacks (URL
    // that resolved to public IP at create-time, private IP now) get
    // caught before we open a socket.
    const syntax = validateUrlSyntax(endpoint.url, {
      httpsRequired: this.httpsRequired,
    });
    if (!syntax.ok || !syntax.parsed) {
      await this.recordFailure(
        delivery,
        `url syntax invalid: ${syntax.issues.join(',')}`,
        null,
      );
      return;
    }
    const resolved = await validateResolvedHost(syntax.parsed.hostname, {
      blockPrivateIps: this.blockPrivateIps,
    });
    if (!resolved.ok) {
      await this.recordFailure(
        delivery,
        `url resolves to blocked ip: ${resolved.issues.join(',')}`,
        null,
      );
      return;
    }

    // Sign at delivery time (see class-level doc). rawBody is exactly
    // the bytes we POST — never a re-serialisation later.
    const rawBody = JSON.stringify(delivery.payloadJson);
    const secret = this.webhookService.decryptSecret(endpoint.secretCipher);
    const sig = sign(secret, rawBody);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let status: number | null = null;
    let bodySnippet: string | null = null;
    let err: string | null = null;
    try {
      const res = await fetch(endpoint.url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Workpulse-Webhooks/1.0',
          'x-workpulse-event': delivery.eventType.toLowerCase().replace(/_/g, '.'),
          'x-workpulse-delivery-id': delivery.id,
          'x-workpulse-signature': sig.header,
        },
        body: rawBody,
        // Do not follow redirects — a 3xx to a private IP would
        // trivially bypass our resolve-check.
        redirect: 'error',
      });
      status = res.status;
      const text = await res.text().catch(() => '');
      bodySnippet = text.slice(0, 512);
    } catch (e) {
      err = (e as Error).message;
    } finally {
      clearTimeout(timer);
    }

    // Persist the signature we actually sent, so operators can trace
    // exactly what the vendor received on the winning attempt.
    delivery.signatureHeader = sig.header;

    const success = status !== null && status >= 200 && status < 300;
    if (success && status !== null) {
      await this.recordSuccess(delivery, endpoint, status, bodySnippet, sig.header);
    } else {
      await this.recordFailure(
        delivery,
        err ?? `http ${status}`,
        status,
        bodySnippet,
        sig.header,
      );
    }
  }

  private async recordSuccess(
    delivery: WebhookDelivery,
    endpoint: WebhookEndpoint,
    status: number,
    bodySnippet: string | null,
    signatureHeader: string,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'SUCCEEDED',
          attemptCount: delivery.attemptCount + 1,
          lastAttemptAt: now,
          deliveredAt: now,
          lastResponseStatus: status,
          lastResponseBodySnippet: bodySnippet,
          lastError: null,
          signatureHeader,
        },
      }),
      this.prisma.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: {
          consecutiveFailures: 0,
          lastSuccessAt: now,
        },
      }),
    ]);
  }

  private async recordFailure(
    delivery: WebhookDelivery,
    errorMessage: string,
    status: number | null,
    bodySnippet: string | null = null,
    signatureHeader: string | null = null,
  ): Promise<void> {
    const previousAttempts = delivery.attemptCount;
    const plan = planNextAttempt(previousAttempts, this.maxAttempts);
    const terminal = plan === null;
    const now = new Date();
    const data: Prisma.WebhookDeliveryUpdateInput = {
      attemptCount: previousAttempts + 1,
      lastAttemptAt: now,
      lastError: errorMessage.slice(0, 500),
      lastResponseStatus: status,
      lastResponseBodySnippet: bodySnippet,
      ...(signatureHeader ? { signatureHeader } : {}),
    };
    if (terminal) {
      data.status = 'FAILED';
      data.nextAttemptAt = now;
    } else {
      data.status = 'PENDING';
      data.nextAttemptAt = plan.nextAttemptAt;
    }
    await this.prisma.$transaction([
      this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data,
      }),
      this.prisma.webhookEndpoint.update({
        where: { id: delivery.endpointId },
        data: {
          consecutiveFailures: { increment: 1 },
          lastFailureAt: now,
        },
      }),
    ]);
  }

  private async markPermanentlyFailed(
    id: string,
    error: string,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: 'FAILED',
        attemptCount: this.maxAttempts,
        lastAttemptAt: now,
        lastError: error,
        nextAttemptAt: now,
      },
    });
  }

  /**
   * Test-only helper — invoked by `POST /test-support/webhook/deliver-now`
   * so E2E specs can force a tick without waiting 30 seconds. Never
   * expose on a production controller.
   */
  async tickForTest(): Promise<void> {
    if (this.tickRunning) return;
    this.tickRunning = true;
    try {
      const claimed = await this.claim();
      for (const row of claimed) {
        await this.deliverOne(row.delivery, row.endpoint);
      }
    } finally {
      this.tickRunning = false;
    }
  }
}
