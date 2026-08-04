import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Filter set understood by the audit log viewer. All fields are optional
 * — sending an empty object returns the most recent rows for the caller's
 * tenant. `from`/`to` are inclusive on the createdAt column.
 *
 * We deliberately do NOT accept a free-text search field. Adding LIKE
 * scans against the potentially-large `AuditLog` table would either
 * table-scan or require a pg_trgm index we don't have yet. Filters map
 * cleanly onto existing indexes:
 *
 *   - `(companyId, entityType, entityId)`: covers entityType[+entityId].
 *   - `(actorId, createdAt)`: covers actorId lookups.
 *
 * When multiple filters are supplied, Postgres picks the most selective
 * index (usually the actor one if present).
 */
export interface AuditLogFilters {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  from?: Date;
  to?: Date;
}

/**
 * Opaque cursor for keyset pagination. We encode `{ createdAt, id }` as a
 * base64 JSON blob so callers can't easily guess future values. The `id`
 * is a tiebreaker for rows with identical timestamps (Prisma seeds use
 * fixed dates, and in production two events can land in the same
 * millisecond).
 */
export interface AuditLogCursor {
  createdAt: string; // ISO
  id: string;
}

export interface AuditLogRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  /** Nullable now that system-driven audit writes are supported (Fase 31c). */
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  beforeJson: Prisma.JsonValue | null;
  afterJson: Prisma.JsonValue | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface AuditLogPage {
  rows: AuditLogRow[];
  /**
   * Opaque cursor to pass in the next request's `cursor` param.
   * `null` when there is no next page.
   */
  nextCursor: string | null;
}

/**
 * Read-only audit log query surface.
 *
 * ## Tenancy
 *
 * Every query is scoped by `actor.companyId`. There is no cross-tenant
 * lane, even for SUPER_ADMIN — the AuditLog contains rows from other
 * tenants that this SUPER_ADMIN identity has no business seeing. When
 * a legitimate cross-tenant investigation is needed (e.g. platform
 * incident review), that's a SQL escalation with its own audit trail.
 *
 * ## Ordering
 *
 * Always `createdAt DESC` with `id DESC` as tiebreaker — newest first,
 * deterministic between rows written in the same millisecond. Matches
 * how compliance auditors read a log ("what just happened").
 *
 * ## Pagination
 *
 * Keyset over `(createdAt, id)` instead of offset. AuditLog can grow
 * to millions of rows over years; offset pagination becomes O(N) at
 * high page indexes. Keyset stays O(log N) regardless of page depth.
 */
@Injectable()
export class AuditService {
  static readonly MAX_LIMIT = 100;
  static readonly DEFAULT_LIMIT = 25;

  // ---- Export defaults (Fase 26) ------------------------------------------
  /**
   * Internal batch size used by `iterate()` for each Postgres round-trip.
   * Small enough to keep memory bounded (~few MB per batch even with
   * large JSON payloads); large enough that we don't chatter with the
   * DB on every yielded row.
   */
  static readonly EXPORT_BATCH_SIZE = 500;
  /**
   * Absolute upper bound on rows the export endpoint will emit for a
   * single request. Compliance workflows rarely need more than a few
   * quarters of history in a single file; anything bigger should be
   * chunked by `from`/`to` on the client side. Prevents a runaway
   * request from holding a DB slot indefinitely.
   */
  static readonly EXPORT_MAX_ROWS = 100_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetch a page of audit log rows for the caller's tenant.
   *
   * @param actor           HR_MANAGER or SUPER_ADMIN (enforced upstream).
   * @param filters         Optional filter set — see `AuditLogFilters`.
   * @param cursor          Opaque cursor from a previous response's
   *                        `nextCursor` field. `undefined` starts at
   *                        the newest row.
   * @param limit           Page size, clamped to `[1, MAX_LIMIT]`.
   */
  async list(
    actor: AuthenticatedUser,
    filters: AuditLogFilters,
    cursor: string | undefined,
    limit: number = AuditService.DEFAULT_LIMIT,
  ): Promise<AuditLogPage> {
    const take = Math.max(1, Math.min(AuditService.MAX_LIMIT, limit));
    const decoded = cursor ? decodeCursor(cursor) : null;

    const where: Prisma.AuditLogWhereInput = {
      companyId: actor.companyId,
      ...(filters.entityType && { entityType: filters.entityType }),
      ...(filters.entityId && { entityId: filters.entityId }),
      ...(filters.actorId && { actorId: filters.actorId }),
      ...(filters.action && { action: filters.action }),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from && { gte: filters.from }),
              ...(filters.to && { lte: filters.to }),
            },
          }
        : {}),
      ...(decoded && {
        // Keyset: "give me everything strictly older than the cursor row".
        // Encode as an OR because Prisma's `lt` on a compound sort would
        // otherwise force us to write raw SQL — the OR is index-friendly
        // when `createdAt` has a matching index.
        OR: [
          { createdAt: { lt: new Date(decoded.createdAt) } },
          {
            createdAt: new Date(decoded.createdAt),
            id: { lt: decoded.id },
          },
        ],
      }),
    };

    // Overfetch by 1 so we can detect "is there a next page" without a
    // separate COUNT query. If we get take+1 rows, drop the last one
    // AND encode its predecessor as the cursor.
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        actorId: true,
        beforeJson: true,
        afterJson: true,
        ip: true,
        userAgent: true,
        createdAt: true,
        actor: { select: { fullName: true, email: true } },
      },
    });

    const hasMore = rows.length > take;
    const trimmed = hasMore ? rows.slice(0, take) : rows;
    const last = trimmed[trimmed.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null;

    return {
      rows: trimmed.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        actorId: r.actorId,
        actorName: r.actor?.fullName ?? null,
        actorEmail: r.actor?.email ?? null,
        beforeJson: r.beforeJson,
        afterJson: r.afterJson,
        ip: r.ip,
        userAgent: r.userAgent,
        createdAt: r.createdAt,
      })),
      nextCursor,
    };
  }

  /**
   * Async-iterate every row matching the filter set, walking the same
   * `(createdAt DESC, id DESC)` keyset used by `list()`. Batches
   * `EXPORT_BATCH_SIZE` rows per Postgres query and stops after
   * `EXPORT_MAX_ROWS` rows in total (or the natural end of data).
   *
   * Used by the NDJSON export endpoint. The generator is
   * memory-bounded — the caller pipes each row into the response
   * stream and never accumulates a full result set.
   *
   * ## Cancellation
   *
   * If the caller stops consuming (client disconnects), the generator
   * simply doesn't schedule the next Postgres round-trip on its next
   * `.next()` — which never happens because Node's async iterator
   * protocol pulls on demand. No explicit abort signal needed.
   */
  async *iterate(
    actor: AuthenticatedUser,
    filters: AuditLogFilters,
    options: { batchSize?: number; maxRows?: number } = {},
  ): AsyncGenerator<AuditLogRow, void, void> {
    // Upper cap protects against a runaway request buffering too many
    // rows per round-trip; the lower bound is just "not zero". Callers
    // should typically leave this unset — the default is tuned for the
    // production trade-off between round-trip overhead and memory.
    const batchSize = Math.max(
      1,
      Math.min(2000, options.batchSize ?? AuditService.EXPORT_BATCH_SIZE),
    );
    const maxRows = Math.max(
      1,
      Math.min(1_000_000, options.maxRows ?? AuditService.EXPORT_MAX_ROWS),
    );

    let cursor: AuditLogCursor | null = null;
    let yielded = 0;

    while (yielded < maxRows) {
      const remaining = maxRows - yielded;
      const take = Math.min(batchSize, remaining);

      const where: Prisma.AuditLogWhereInput = {
        companyId: actor.companyId,
        ...(filters.entityType && { entityType: filters.entityType }),
        ...(filters.entityId && { entityId: filters.entityId }),
        ...(filters.actorId && { actorId: filters.actorId }),
        ...(filters.action && { action: filters.action }),
        ...(filters.from || filters.to
          ? {
              createdAt: {
                ...(filters.from && { gte: filters.from }),
                ...(filters.to && { lte: filters.to }),
              },
            }
          : {}),
        ...(cursor && {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            {
              createdAt: new Date(cursor.createdAt),
              id: { lt: cursor.id },
            },
          ],
        }),
      };

      const rows = await this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          actorId: true,
          beforeJson: true,
          afterJson: true,
          ip: true,
          userAgent: true,
          createdAt: true,
          actor: { select: { fullName: true, email: true } },
        },
      });

      if (rows.length === 0) return;

      for (const r of rows) {
        yield {
          id: r.id,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          actorId: r.actorId,
          actorName: r.actor?.fullName ?? null,
          actorEmail: r.actor?.email ?? null,
          beforeJson: r.beforeJson,
          afterJson: r.afterJson,
          ip: r.ip,
          userAgent: r.userAgent,
          createdAt: r.createdAt,
        };
        yielded += 1;
        if (yielded >= maxRows) return;
      }

      // Short read = natural end of data. Skips one wasted round-trip.
      if (rows.length < take) return;

      const last = rows[rows.length - 1]!;
      cursor = { createdAt: last.createdAt.toISOString(), id: last.id };
    }
  }
}

// ---------------------------------------------------------------------------
// Cursor codec — internal
// ---------------------------------------------------------------------------

function encodeCursor(c: AuditLogCursor): string {
  // Base64URL keeps the value safe as a query param without extra
  // escaping. `Buffer.from(...).toString('base64url')` is available on
  // Node 16+; we're on 20, so it's fine.
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): AuditLogCursor {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as Partial<AuditLogCursor>;
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.createdAt))
    ) {
      throw new Error('malformed cursor');
    }
    return { id: parsed.id, createdAt: parsed.createdAt };
  } catch {
    // Surface as 400 — a garbage cursor is a client mistake, not a
    // server one. Better than silently returning page-1 (which would
    // trap the caller in an infinite loop of "hitting the same page").
    throw new BadRequestException('INVALID_CURSOR');
  }
}
