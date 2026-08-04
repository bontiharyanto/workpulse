import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, WebhookEventType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Wire-format of every webhook body. Kept flat + tenant-scoped so a
 * vendor can multiplex multiple tenants over one URL if they want.
 */
export interface WebhookEnvelope {
  id: string; // event id (delivery id)
  type: string; // dotted lowercase, e.g. "timesheet.export.created"
  occurredAt: string; // ISO-8601
  tenant: { companyId: string };
  data: Record<string, unknown>;
}

export interface EnqueueInput {
  companyId: string;
  eventType: WebhookEventType;
  /** Foreign key of the source entity — used for idempotency. */
  sourceId: string;
  data: Record<string, unknown>;
}

/**
 * Fase 32e — event dispatcher. Called from the domain services
 * (`TimesheetExportService`, `TimesheetExportShareService`) right AFTER
 * their commit — never inside their transactions.
 *
 * Design invariants:
 *
 *   1. **Never throw upstream.** A misconfigured webhook must NOT block
 *      a payroll export from completing. Every failure path is
 *      swallowed with a log line; the worker will retry.
 *   2. **Idempotent enqueue.** `(endpointId, eventType, sourceId)` is a
 *      unique index. Re-firing the same event (e.g. export re-run) is
 *      a no-op instead of a duplicate delivery.
   *   3. **Sign at delivery-time, not enqueue-time.** Postgres `jsonb`
   *      does NOT preserve key order, so we can't freeze a
   *      byte-identical signature at enqueue and still match on read
   *      after a retry. The worker computes the HMAC over
   *      `JSON.stringify(delivery.payloadJson)` at each attempt — this
   *      means the signature timestamp reflects actual send time,
   *      matching the Stripe pattern and letting vendors enforce a
   *      tight (5-minute) tolerance window.
   */
@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(input: EnqueueInput): Promise<void> {
    try {
      await this.enqueueInternal(input);
    } catch (err) {
      // Deliberately swallow — see the class-level invariant.
      this.logger.error(
        `webhook enqueue failed for company=${input.companyId} event=${input.eventType} source=${input.sourceId}: ${(err as Error).message}`,
      );
    }
  }

  private async enqueueInternal(input: EnqueueInput): Promise<void> {
    // Pick the endpoints subscribed to this event. Skipping inactive
    // endpoints here means "toggling off" is instant, without needing
    // the worker to check on each attempt.
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        companyId: input.companyId,
        active: true,
        events: { has: input.eventType },
      },
    });
    if (endpoints.length === 0) return;

    for (const endpoint of endpoints) {
      const now = new Date();
      const eventId = deliveryEventId(endpoint.id, input.eventType, input.sourceId);
      const envelope: WebhookEnvelope = {
        id: eventId,
        type: wireEventName(input.eventType),
        occurredAt: now.toISOString(),
        tenant: { companyId: input.companyId },
        data: input.data,
      };

      // Upsert-on-conflict: unique index (endpointId, eventType, sourceId).
      // Re-enqueue of the same source event is a no-op — we don't want
      // a re-run to overwrite the audit trail.
      //
      // `signatureHeader` is populated by the worker at the first
      // delivery attempt (see webhook.worker.ts). Placeholder here so
      // the NOT NULL column is happy; overwritten on first send.
      try {
        await this.prisma.webhookDelivery.create({
          data: {
            endpointId: endpoint.id,
            companyId: input.companyId,
            eventType: input.eventType,
            sourceId: input.sourceId,
            payloadJson: envelope as unknown as Prisma.InputJsonValue,
            signatureHeader: '',
            nextAttemptAt: now,
          },
        });
      } catch (err) {
        // P2002 = unique violation. Anything else propagates to the
        // outer catch which just logs.
        if ((err as { code?: string }).code === 'P2002') {
          this.logger.debug(
            `webhook dedup: endpoint=${endpoint.id} event=${input.eventType} source=${input.sourceId}`,
          );
          continue;
        }
        throw err;
      }
    }
  }
}

/**
 * Deterministic event id derived from (endpoint, event, source). Not
 * a security boundary — vendors should treat it as opaque — but it
 * lets us reason about "did the vendor ever see this exact event?"
 * without a round-trip.
 */
function deliveryEventId(
  endpointId: string,
  eventType: WebhookEventType,
  sourceId: string,
): string {
  return `evt_${endpointId.slice(0, 8)}_${eventType.toLowerCase()}_${sourceId.slice(0, 12)}`;
}

export function wireEventName(eventType: WebhookEventType): string {
  return eventType.toLowerCase().replace(/_/g, '.');
}
