import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditLogPageDto, AuditLogRowDto } from './dto/audit-log-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

/**
 * Read-only audit log surface for HR / compliance. Writers are scattered
 * across the codebase (leave decisions, overtime, manual absence, config
 * updates, scanner cursor resets, …). This controller is the ONLY read
 * lane exposed to non-DBAs.
 *
 * Rate limited more aggressively than typical GET endpoints because the
 * query is potentially expensive (large scans without a selective filter)
 * and there is no legitimate reason for a human to poll it faster than
 * once a second.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin/audit-log', version: '1' })
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOkResponse({ type: AuditLogPageDto })
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: AuditLogQueryDto,
  ): Promise<AuditLogPageDto> {
    const page = await this.audit.list(
      actor,
      {
        entityType: query.entityType,
        entityId: query.entityId,
        actorId: query.actorId,
        action: query.action,
        from: query.from,
        to: query.to,
      },
      query.cursor,
      query.limit,
    );
    const rows: AuditLogRowDto[] = page.rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actorId: r.actorId,
      actorName: r.actorName,
      actorEmail: r.actorEmail,
      beforeJson: r.beforeJson,
      afterJson: r.afterJson,
      ip: r.ip,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
    }));
    return { rows, nextCursor: page.nextCursor };
  }

  /**
   * Streaming NDJSON export of the caller-tenant's audit log
   * (Fase 26 — follow-up ADR-0013).
   *
   * Contract:
   *   * `Content-Type: application/x-ndjson; charset=utf-8`
   *   * One JSON object per line, terminated with `\n`. No wrapping
   *     envelope, no BOM, no trailing comma.
   *   * Row shape matches `AuditLogRowDto` — the JSON `GET /admin/audit-log`
   *     rows verbatim. Compliance tooling can parse with `jq`,
   *     `pandas.read_json(lines=True)`, or any streaming NDJSON reader.
   *   * Hard cap of `AuditService.EXPORT_MAX_ROWS` per request. When
   *     hit, the stream simply stops — a partial file is a legitimate
   *     result. If callers need a bigger range, chunk by `from`/`to`.
   *
   * Ops considerations:
   *   * Throttled to 3 exports per minute per identity. Expensive
   *     query; humans don't run it in a loop.
   *   * `res.setTimeout(0)` disables the default Node response
   *     timeout so nginx / a reverse proxy is the only party imposing
   *     an outer limit.
   *   * Handles client disconnect: if the socket closes mid-stream,
   *     the async generator naturally stops (no next .next() ever
   *     called). We also short-circuit on `res.writableEnded`.
   *   * Backpressure: `res.write()` returns false when the internal
   *     buffer is full; we await `drain` before continuing.
   *
   * Filter accepts the same keys as the JSON endpoint minus
   * `cursor`/`limit` (whole result set is streamed).
   */
  @Get('export')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async exportNdjson(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: AuditLogQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const filename = `audit-log-${todayIsoDate()}.ndjson`;

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Never proxy-cache — response contains tenant-specific audit
    // trail; a shared cache would leak between callers.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Long streams may exceed Node's default 5-minute socket timeout.
    // Disable it here; the reverse proxy (nginx) enforces the outer
    // limit in production.
    res.setTimeout?.(0);

    const filters = {
      entityType: query.entityType,
      entityId: query.entityId,
      actorId: query.actorId,
      action: query.action,
      from: query.from,
      to: query.to,
    };

    try {
      for await (const r of this.audit.iterate(actor, filters)) {
        if (res.writableEnded || res.destroyed) return;
        const line =
          JSON.stringify({
            id: r.id,
            action: r.action,
            entityType: r.entityType,
            entityId: r.entityId,
            actorId: r.actorId,
            actorName: r.actorName,
            actorEmail: r.actorEmail,
            beforeJson: r.beforeJson,
            afterJson: r.afterJson,
            ip: r.ip,
            userAgent: r.userAgent,
            createdAt: r.createdAt.toISOString(),
          }) + '\n';
        const ok = res.write(line);
        if (!ok) {
          // Backpressure — wait for the socket to drain before
          // scheduling the next Postgres round-trip. Not doing this
          // can accumulate 100k rows in the Node.js output buffer
          // and OOM the container.
          await new Promise<void>((resolve) => {
            res.once('drain', resolve);
          });
        }
      }
      res.end();
    } catch (err) {
      // If we've already sent headers, we can't switch to a 500 —
      // the caller will see a truncated stream. Log via NestJS's
      // exception filter (rethrow only when nothing has been sent).
      if (!res.headersSent) {
        throw err;
      }
      res.end();
    }
  }
}

/**
 * `YYYY-MM-DD` in UTC, used only as a filename hint. Deliberately UTC
 * (not tenant timezone) so files sorted alphabetically also sort
 * chronologically for the same tenant regardless of caller's tz.
 */
function todayIsoDate(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
