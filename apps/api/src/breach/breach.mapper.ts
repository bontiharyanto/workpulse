import type { BreachIncident, BreachTimelineEvent } from '@prisma/client';

import { snapshot } from './domain/deadline';
import type {
  BreachIncidentListItemDto,
  BreachIncidentResponseDto,
  BreachTimelineEventDto,
} from './dto/breach.dto';

/**
 * Fase 31g — Prisma → DTO mappers.
 *
 * Keep this file free of business logic; every derivation belongs in
 * the domain layer. The mapper's only job is shape translation +
 * timestamp serialisation.
 */

type IncidentRelations = {
  reportedBy: { email: string } | null;
  assignedTo: { email: string } | null;
  timeline: (BreachTimelineEvent & { actor: { email: string } | null })[];
};

export function toTimelineDto(
  row: BreachTimelineEvent & { actor: { email: string } | null },
): BreachTimelineEventDto {
  return {
    id: row.id,
    eventType: row.eventType,
    note: row.note,
    metadata: row.metadata === null ? null : (row.metadata as unknown as Record<string, unknown>),
    actorId: row.actorId,
    actorEmail: row.actor?.email ?? null,
    occurredAt: row.occurredAt.toISOString(),
  };
}

export function toDetailDto(
  row: BreachIncident & IncidentRelations,
  now: Date = new Date(),
): BreachIncidentResponseDto {
  const deadline = snapshot(row.detectedAt, row.status, now);
  return {
    id: row.id,
    companyId: row.companyId,
    title: row.title,
    description: row.description,
    severity: row.severity,
    category: row.category,
    status: row.status,
    detectedAt: row.detectedAt.toISOString(),
    occurredAt: row.occurredAt?.toISOString() ?? null,
    containedAt: row.containedAt?.toISOString() ?? null,
    authorityNotifiedAt: row.authorityNotifiedAt?.toISOString() ?? null,
    subjectsNotifiedAt: row.subjectsNotifiedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    affectedUserCount: row.affectedUserCount,
    affectedDataCategories: row.affectedDataCategories,
    affectedSystems: row.affectedSystems,
    containmentActions: row.containmentActions,
    rootCause: row.rootCause,
    remediation: row.remediation,
    authorityNotificationRef: row.authorityNotificationRef,
    subjectNotificationTemplate: row.subjectNotificationTemplate,
    reportedById: row.reportedById,
    reportedByEmail: row.reportedBy?.email ?? null,
    assignedToId: row.assignedToId,
    assignedToEmail: row.assignedTo?.email ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deadline: {
      deadlineAt: deadline.deadlineAt.toISOString(),
      hoursRemaining: Number(deadline.hoursRemaining.toFixed(2)),
      bucket: deadline.bucket,
      overdue: deadline.overdue,
      active: deadline.active,
    },
    timeline: row.timeline.map(toTimelineDto),
  };
}

export function toListItemDto(
  row: BreachIncident & {
    reportedBy: { email: string } | null;
    assignedTo: { email: string } | null;
  },
  now: Date = new Date(),
): BreachIncidentListItemDto {
  const deadline = snapshot(row.detectedAt, row.status, now);
  return {
    id: row.id,
    title: row.title,
    severity: row.severity,
    category: row.category,
    status: row.status,
    detectedAt: row.detectedAt.toISOString(),
    authorityNotifiedAt: row.authorityNotifiedAt?.toISOString() ?? null,
    affectedUserCount: row.affectedUserCount,
    deadline: {
      deadlineAt: deadline.deadlineAt.toISOString(),
      hoursRemaining: Number(deadline.hoursRemaining.toFixed(2)),
      bucket: deadline.bucket,
      overdue: deadline.overdue,
      active: deadline.active,
    },
    reportedByEmail: row.reportedBy?.email ?? null,
    assignedToEmail: row.assignedTo?.email ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
