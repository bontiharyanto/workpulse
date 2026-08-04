import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BreachCategory,
  BreachIncident,
  BreachSeverity,
  BreachStatus,
  BreachTimelineEvent,
  BreachTimelineEventType,
  Prisma,
} from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import { snapshot } from './domain/deadline';
import {
  BreachTransition,
  IllegalBreachTransitionError,
  isTerminal,
  transition,
} from './domain/state-machine';

/**
 * Fase 31g — BreachIncident CRUD + lifecycle service.
 *
 * Every mutation writes an `AuditLog` **and** a `BreachTimelineEvent`
 * inside the same `$transaction` — the timeline is the regulator-
 * facing view, `AuditLog` is the SecOps view; both must exist for a
 * complete legal exhibit.
 *
 * Tenant scoping: every read/write is filtered by
 * `actor.companyId`. Cross-tenant access is not a business feature.
 */

type IncidentWithTimeline = BreachIncident & {
  timeline: (BreachTimelineEvent & { actor: { email: string } | null })[];
  reportedBy: { email: string } | null;
  assignedTo: { email: string } | null;
};

interface CreateInput {
  title: string;
  description: string;
  severity: BreachSeverity;
  category: BreachCategory;
  detectedAt: Date;
  occurredAt?: Date;
  affectedUserCount?: number;
  affectedDataCategories?: string[];
  affectedSystems?: string[];
  containmentActions?: string;
  assignedToId?: string;
}

interface UpdateInput {
  title?: string;
  description?: string;
  severity?: BreachSeverity;
  category?: BreachCategory;
  occurredAt?: Date;
  affectedUserCount?: number;
  affectedDataCategories?: string[];
  affectedSystems?: string[];
  containmentActions?: string;
  rootCause?: string;
  remediation?: string;
  assignedToId?: string;
}

const INCLUDE_FULL = {
  reportedBy: { select: { email: true } },
  assignedTo: { select: { email: true } },
  timeline: {
    orderBy: { occurredAt: 'asc' as const },
    include: { actor: { select: { email: true } } },
  },
} satisfies Prisma.BreachIncidentInclude;

const SEVERITY_LABEL: Record<BreachSeverity, string> = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};

@Injectable()
export class BreachService {
  private readonly logger = new Logger(BreachService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------- Read paths --------

  async list(actor: AuthenticatedUser): Promise<
    (BreachIncident & {
      reportedBy: { email: string } | null;
      assignedTo: { email: string } | null;
    })[]
  > {
    return this.prisma.breachIncident.findMany({
      where: { companyId: actor.companyId },
      orderBy: [{ status: 'asc' }, { detectedAt: 'desc' }],
      include: {
        reportedBy: { select: { email: true } },
        assignedTo: { select: { email: true } },
      },
    });
  }

  async detail(actor: AuthenticatedUser, id: string): Promise<IncidentWithTimeline> {
    const row = await this.prisma.breachIncident.findFirst({
      where: { id, companyId: actor.companyId },
      include: INCLUDE_FULL,
    });
    if (!row) throw new NotFoundException('BREACH_NOT_FOUND');
    return row as IncidentWithTimeline;
  }

  // -------- Create / update / assign --------

  async create(actor: AuthenticatedUser, input: CreateInput): Promise<IncidentWithTimeline> {
    this.assertPastOrPresent(input.detectedAt, 'detectedAt');
    if (input.occurredAt) {
      if (input.occurredAt.getTime() > input.detectedAt.getTime()) {
        throw new BadRequestException('OCCURRED_AFTER_DETECTED');
      }
    }
    if (input.assignedToId) {
      await this.assertUserInSameTenant(actor.companyId, input.assignedToId);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.breachIncident.create({
        data: {
          companyId: actor.companyId,
          title: input.title,
          description: input.description,
          severity: input.severity,
          category: input.category,
          detectedAt: input.detectedAt,
          occurredAt: input.occurredAt ?? null,
          affectedUserCount: input.affectedUserCount ?? 0,
          affectedDataCategories: input.affectedDataCategories ?? [],
          affectedSystems: input.affectedSystems ?? [],
          containmentActions: input.containmentActions ?? '',
          reportedById: actor.id,
          assignedToId: input.assignedToId ?? null,
        },
      });
      await this.appendTimeline(tx, {
        incidentId: row.id,
        companyId: row.companyId,
        eventType: BreachTimelineEventType.CREATED,
        note: `Incident opened at severity ${SEVERITY_LABEL[row.severity]}`,
        metadata: {
          severity: row.severity,
          category: row.category,
          detectedAt: row.detectedAt.toISOString(),
        },
        actorId: actor.id,
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'BREACH_INCIDENT_CREATED',
          entityType: 'BreachIncident',
          entityId: row.id,
          afterJson: {
            title: row.title,
            severity: row.severity,
            category: row.category,
            detectedAt: row.detectedAt.toISOString(),
          } satisfies Prisma.InputJsonValue,
        },
      });
      return row;
    });
    return this.detail(actor, created.id);
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateInput,
  ): Promise<IncidentWithTimeline> {
    const existing = await this.loadWritable(actor, id);
    if (input.occurredAt) {
      const detected = existing.detectedAt.getTime();
      if (input.occurredAt.getTime() > detected) {
        throw new BadRequestException('OCCURRED_AFTER_DETECTED');
      }
    }
    if (input.assignedToId) {
      await this.assertUserInSameTenant(actor.companyId, input.assignedToId);
    }

    const dataDiff: Record<string, unknown> = {};
    for (const k of Object.keys(input) as (keyof UpdateInput)[]) {
      const v = input[k];
      if (v === undefined) continue;
      dataDiff[k] = v instanceof Date ? v.toISOString() : v;
    }
    if (Object.keys(dataDiff).length === 0) {
      return this.detail(actor, id);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.breachIncident.update({
        where: { id },
        data: input,
      });
      await this.appendTimeline(tx, {
        incidentId: id,
        companyId: actor.companyId,
        eventType: BreachTimelineEventType.UPDATED,
        note: 'Incident details updated',
        metadata: dataDiff as Prisma.InputJsonValue,
        actorId: actor.id,
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'BREACH_INCIDENT_UPDATED',
          entityType: 'BreachIncident',
          entityId: id,
          afterJson: dataDiff as Prisma.InputJsonValue,
        },
      });
    });
    return this.detail(actor, id);
  }

  // -------- Lifecycle transitions --------

  async markContained(
    actor: AuthenticatedUser,
    id: string,
    note?: string,
  ): Promise<IncidentWithTimeline> {
    return this.advance(actor, id, 'MARK_CONTAINED', {
      containedAt: new Date(),
      note: note ?? 'Breach contained',
    });
  }

  async notifyAuthority(
    actor: AuthenticatedUser,
    id: string,
    payload: { notifiedAt: Date; authorityRef: string; note?: string },
  ): Promise<IncidentWithTimeline> {
    const existing = await this.loadWritable(actor, id);
    if (payload.notifiedAt.getTime() < existing.detectedAt.getTime()) {
      throw new BadRequestException('AUTHORITY_NOTIFIED_BEFORE_DETECTED');
    }
    return this.advance(actor, id, 'MARK_AUTHORITY_NOTIFIED', {
      authorityNotifiedAt: payload.notifiedAt,
      authorityNotificationRef: payload.authorityRef,
      note: payload.note ?? `Authority notified (ref: ${payload.authorityRef})`,
      timelineEventType: BreachTimelineEventType.AUTHORITY_NOTIFIED,
      metadata: {
        authorityRef: payload.authorityRef,
        notifiedAt: payload.notifiedAt.toISOString(),
      },
    });
  }

  async notifySubjects(
    actor: AuthenticatedUser,
    id: string,
    payload: { notifiedAt: Date; template: string; note?: string },
  ): Promise<IncidentWithTimeline> {
    const existing = await this.loadWritable(actor, id);
    if (payload.notifiedAt.getTime() < existing.detectedAt.getTime()) {
      throw new BadRequestException('SUBJECTS_NOTIFIED_BEFORE_DETECTED');
    }
    return this.advance(actor, id, 'MARK_SUBJECTS_NOTIFIED', {
      subjectsNotifiedAt: payload.notifiedAt,
      subjectNotificationTemplate: payload.template,
      note:
        payload.note ??
        `Data subjects notified — ${payload.template.length} chars template on record`,
      timelineEventType: BreachTimelineEventType.SUBJECTS_NOTIFIED,
      metadata: {
        notifiedAt: payload.notifiedAt.toISOString(),
        templateLength: payload.template.length,
      },
    });
  }

  async close(
    actor: AuthenticatedUser,
    id: string,
    payload: { postMortemSummary: string },
  ): Promise<IncidentWithTimeline> {
    const existing = await this.loadWritable(actor, id);
    // Only allow direct close from DETECTED/CONTAINED when severity is
    // LOW — matches the state-machine escape hatch.
    const bypassStatuses: BreachStatus[] = [
      BreachStatus.DETECTED,
      BreachStatus.CONTAINED,
      BreachStatus.NOTIFIED_AUTHORITY,
    ];
    if (
      bypassStatuses.includes(existing.status) &&
      existing.severity !== BreachSeverity.LOW &&
      existing.status !== BreachStatus.NOTIFIED_AUTHORITY
    ) {
      throw new BadRequestException('CLOSE_REQUIRES_NOTIFICATION');
    }
    return this.advance(actor, id, 'CLOSE', {
      closedAt: new Date(),
      remediation: payload.postMortemSummary,
      note: `Incident closed. ${payload.postMortemSummary.slice(0, 200)}`,
      timelineEventType: BreachTimelineEventType.CLOSED,
    });
  }

  async appendNote(
    actor: AuthenticatedUser,
    id: string,
    note: string,
  ): Promise<IncidentWithTimeline> {
    await this.loadWritable(actor, id);
    await this.prisma.$transaction(async (tx) => {
      await this.appendTimeline(tx, {
        incidentId: id,
        companyId: actor.companyId,
        eventType: BreachTimelineEventType.NOTE_ADDED,
        note,
        actorId: actor.id,
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'BREACH_NOTE_ADDED',
          entityType: 'BreachIncident',
          entityId: id,
          afterJson: {
            note,
          } satisfies Prisma.InputJsonValue,
        },
      });
    });
    return this.detail(actor, id);
  }

  /**
   * Append a `DEADLINE_WARNED` timeline event. Called by the reminder
   * worker — the worker owns dedup (one warning per bucket per
   * incident); this method is the write primitive only.
   */
  async recordDeadlineWarning(input: {
    incidentId: string;
    companyId: string;
    bucket: string;
    hoursRemaining: number;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.appendTimeline(tx, {
        incidentId: input.incidentId,
        companyId: input.companyId,
        eventType: BreachTimelineEventType.DEADLINE_WARNED,
        note: `Deadline warning: ${input.bucket} (${input.hoursRemaining.toFixed(1)}h remaining)`,
        metadata: {
          bucket: input.bucket,
          hoursRemaining: Number(input.hoursRemaining.toFixed(2)),
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: input.companyId,
          actorId: null,
          action: 'BREACH_DEADLINE_WARNED',
          entityType: 'BreachIncident',
          entityId: input.incidentId,
          afterJson: {
            bucket: input.bucket,
            hoursRemaining: Number(input.hoursRemaining.toFixed(2)),
          } satisfies Prisma.InputJsonValue,
        },
      });
    });
  }

  // -------- Snapshot helper --------

  static withDeadline<T extends { detectedAt: Date; status: BreachStatus }>(
    row: T,
    now: Date = new Date(),
  ): T & {
    deadline: ReturnType<typeof snapshot>;
  } {
    return { ...row, deadline: snapshot(row.detectedAt, row.status, now) };
  }

  // -------- Internals --------

  private async advance(
    actor: AuthenticatedUser,
    id: string,
    action: BreachTransition,
    payload: {
      containedAt?: Date;
      authorityNotifiedAt?: Date;
      authorityNotificationRef?: string;
      subjectsNotifiedAt?: Date;
      subjectNotificationTemplate?: string;
      closedAt?: Date;
      remediation?: string;
      note: string;
      timelineEventType?: BreachTimelineEventType;
      metadata?: Record<string, unknown>;
    },
  ): Promise<IncidentWithTimeline> {
    const existing = await this.loadWritable(actor, id);
    let nextStatus: BreachStatus;
    try {
      nextStatus = transition(existing.status, action);
    } catch (err) {
      if (err instanceof IllegalBreachTransitionError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const updateData: Prisma.BreachIncidentUpdateInput = {
      status: nextStatus,
    };
    if (payload.containedAt) updateData.containedAt = payload.containedAt;
    if (payload.authorityNotifiedAt) updateData.authorityNotifiedAt = payload.authorityNotifiedAt;
    if (payload.authorityNotificationRef)
      updateData.authorityNotificationRef = payload.authorityNotificationRef;
    if (payload.subjectsNotifiedAt) updateData.subjectsNotifiedAt = payload.subjectsNotifiedAt;
    if (payload.subjectNotificationTemplate)
      updateData.subjectNotificationTemplate = payload.subjectNotificationTemplate;
    if (payload.closedAt) updateData.closedAt = payload.closedAt;
    if (payload.remediation) updateData.remediation = payload.remediation;

    await this.prisma.$transaction(async (tx) => {
      await tx.breachIncident.update({
        where: { id },
        data: updateData,
      });
      const timelineType = payload.timelineEventType ?? BreachTimelineEventType.STATUS_ADVANCED;
      await this.appendTimeline(tx, {
        incidentId: id,
        companyId: actor.companyId,
        eventType: timelineType,
        note: payload.note,
        metadata: {
          fromStatus: existing.status,
          toStatus: nextStatus,
          ...(payload.metadata ?? {}),
        } as Prisma.InputJsonValue,
        actorId: actor.id,
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: `BREACH_${nextStatus}`,
          entityType: 'BreachIncident',
          entityId: id,
          beforeJson: {
            status: existing.status,
          } satisfies Prisma.InputJsonValue,
          afterJson: {
            status: nextStatus,
            ...(payload.metadata ?? {}),
          } satisfies Prisma.InputJsonValue,
        },
      });
    });
    return this.detail(actor, id);
  }

  private async loadWritable(actor: AuthenticatedUser, id: string): Promise<BreachIncident> {
    const row = await this.prisma.breachIncident.findFirst({
      where: { id, companyId: actor.companyId },
    });
    if (!row) throw new NotFoundException('BREACH_NOT_FOUND');
    if (isTerminal(row.status)) {
      throw new ForbiddenException('BREACH_ALREADY_CLOSED');
    }
    return row;
  }

  private async assertUserInSameTenant(companyId: string, userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: { id: true },
    });
    if (!user) throw new BadRequestException('ASSIGNEE_NOT_IN_TENANT');
  }

  private assertPastOrPresent(dt: Date, label: string): void {
    if (dt.getTime() > Date.now() + 60_000) {
      // Small clock-skew allowance for tests + client-side wall clocks.
      throw new BadRequestException(`${label.toUpperCase()}_IN_FUTURE`);
    }
  }

  private async appendTimeline(
    tx: Prisma.TransactionClient,
    input: {
      incidentId: string;
      companyId: string;
      eventType: BreachTimelineEventType;
      note: string;
      metadata?: Prisma.InputJsonValue;
      actorId?: string;
    },
  ): Promise<void> {
    await tx.breachTimelineEvent.create({
      data: {
        incidentId: input.incidentId,
        companyId: input.companyId,
        eventType: input.eventType,
        note: input.note,
        metadata: input.metadata ?? Prisma.JsonNull,
        actorId: input.actorId ?? null,
      },
    });
  }
}
