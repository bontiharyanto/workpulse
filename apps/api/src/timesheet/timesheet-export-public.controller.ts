import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Ip,
  Query,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { Public } from '../auth/decorators/public.decorator';

import { TimesheetExportShareService } from './timesheet-export-share.service';

/**
 * Fase 32d — unauthenticated download endpoint for signed timesheet
 * export links. The signature IS the authorisation; the route is
 * gated by:
 *
 *   1. HMAC-SHA256 verification against the process secret.
 *   2. DB lookup of the share row (must exist, not revoked, expiry
 *      matches the signed `expires` value).
 *   3. Byte-level integrity check on the persisted payload.
 *
 * We deliberately serve a generic 403 for every failure mode so a
 * casual attacker can't distinguish "wrong signature" from "revoked
 * link" — the details are logged server-side. `EXPORT_PAYLOAD_UNAVAILABLE`
 * (pre-32d row, no persisted bytes) surfaces as 410 so the vendor
 * knows the link itself was well-formed but the file is gone.
 *
 * Not documented in Swagger — the URL is machine-only and OpenAPI
 * would only leak the query-param names to a public spec.
 */
@ApiExcludeController()
@Controller({ path: 'public/timesheet-exports', version: '1' })
// Throttle the anonymous endpoint aggressively. Downloads are rare
// per-share (one to a handful) but a URL leak turns into a
// brute-force target — 60 hits/min per IP is a comfortable ceiling.
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class TimesheetExportPublicController {
  constructor(private readonly shares: TimesheetExportShareService) {}

  @Get('download')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Public()
  async download(
    @Query('id') shareId: string | undefined,
    @Query('expires') expires: string | undefined,
    @Query('signature') signature: string | undefined,
    @Ip() ip: string | undefined,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    if (!shareId || !expires || !signature) {
      // Missing query params → same generic 403 as a bad signature.
      // Never hint which one was missing.
      throw new BadRequestException('SHARE_INVALID');
    }
    const expiresMs = Number(expires);
    if (!Number.isFinite(expiresMs) || expiresMs <= 0) {
      throw new BadRequestException('SHARE_INVALID');
    }

    const { result } = await this.shares.verifyAndDownload(shareId, expiresMs, signature, ip);

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Payload-Sha256', result.export.payloadSha256);
    res.setHeader('X-Export-Id', result.export.id);
    res.setHeader('Content-Length', String(result.payload.length));
    res.status(HttpStatus.OK).end(result.payload);
  }
}
