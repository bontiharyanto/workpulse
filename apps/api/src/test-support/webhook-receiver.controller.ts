import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { Public } from '../auth/decorators/public.decorator';

interface CapturedRequest {
  receivedAt: string;
  headers: Record<string, string>;
  /** Raw request body as UTF-8 string — signature checks in the E2E
   *  MUST hash against this exact byte sequence, not against a
   *  JSON-round-tripped copy (JSON.stringify does not guarantee
   *  byte-parity with the sender). */
  rawBody: string;
  body: unknown;
}

/**
 * Fase 32e — in-memory sink used by the webhook E2E. HR configures a
 * webhook endpoint whose URL points at this controller, triggers a
 * timesheet export, then reads back the captured POST for assertions
 * (correct signature header, correct payload shape).
 *
 * State lives in a module-level Map keyed by an opaque `bucket` query
 * param. Buckets isolate concurrent test runs — the tests use a
 * random UUID per spec. The Map is cleared on any `POST clear` for
 * safety when tests reuse the same test bench pid.
 *
 * This controller is gated by the same `THROTTLER_DISABLED=true`
 * check as the rest of `test-support`. In production `env.validation`
 * refuses that flag, so the receiver is guaranteed 403 in prod.
 */
@ApiExcludeController()
@Controller({ path: 'test-support/webhook-sink', version: '1' })
export class WebhookReceiverController {
  private static readonly buckets = new Map<string, CapturedRequest[]>();

  constructor(private readonly config: ConfigService) {}

  @Post('receive')
  @HttpCode(HttpStatus.OK)
  @Public()
  async receive(
    @Query('bucket') bucket: string | undefined,
    @Headers() headers: Record<string, string>,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ ok: true }> {
    this.assertEnabled();
    if (!bucket) throw new ForbiddenException('bucket required');
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';
    // Parsed body is best-effort — used for the FE table + convenience
    // assertions. Signature checks must use `rawBody`.
    let parsed: unknown = null;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      /* Ignored — non-JSON payloads are still captured. */
    }
    const list = WebhookReceiverController.buckets.get(bucket) ?? [];
    list.push({
      receivedAt: new Date().toISOString(),
      headers: Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
      ),
      rawBody,
      body: parsed,
    });
    WebhookReceiverController.buckets.set(bucket, list);
    return { ok: true };
  }

  @Get('read')
  @Public()
  async read(
    @Query('bucket') bucket: string | undefined,
  ): Promise<{ items: CapturedRequest[] }> {
    this.assertEnabled();
    if (!bucket) throw new ForbiddenException('bucket required');
    return { items: WebhookReceiverController.buckets.get(bucket) ?? [] };
  }

  @Post('clear')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async clear(@Query('bucket') bucket: string | undefined): Promise<void> {
    this.assertEnabled();
    if (bucket) {
      WebhookReceiverController.buckets.delete(bucket);
    } else {
      WebhookReceiverController.buckets.clear();
    }
  }

  private assertEnabled(): void {
    const flag = this.config.get<string>('THROTTLER_DISABLED', 'false');
    if (flag !== 'true') {
      throw new ForbiddenException('test-support routes disabled');
    }
  }
}
