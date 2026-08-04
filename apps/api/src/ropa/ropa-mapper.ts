import type { RopaActivity, RopaActivityVersion } from '@prisma/client';

import type {
  RopaActivityDetailDto,
  RopaActivityListItemDto,
  RopaLegalBasisDto,
  RopaVersionResponseDto,
} from './dto/ropa.dto';
import type { RopaDetail, RopaListItem } from './ropa-registry.service';

/**
 * Fase 31d — Prisma → DTO mappers.
 *
 * Isolated so the controller stays declarative and unit tests can inspect
 * the JSON shape without touching the service.
 */

export function toVersionDto(row: RopaActivityVersion): RopaVersionResponseDto {
  return {
    id: row.id,
    activityId: row.activityId,
    version: row.version,
    status: row.status,
    name: row.name,
    purpose: row.purpose,
    legalBasis: row.legalBasis as RopaLegalBasisDto,
    legalBasisDetail: row.legalBasisDetail,
    dataCategories: row.dataCategories,
    subjectCategories: row.subjectCategories,
    recipients: row.recipients,
    retentionPeriod: row.retentionPeriod,
    crossBorderTransfer: row.crossBorderTransfer,
    crossBorderDetail: row.crossBorderDetail,
    securityMeasures: row.securityMeasures,
    notes: row.notes,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    reviewedById: row.reviewedById,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    publishedById: row.publishedById,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

export function toListItemDto(item: RopaListItem): RopaActivityListItemDto {
  return {
    activityId: item.activityId,
    slug: item.slug,
    currentVersion: item.currentVersion ? toVersionDto(item.currentVersion) : null,
    draftVersion: item.draftVersion ? toVersionDto(item.draftVersion) : null,
    reviewVersion: item.reviewVersion ? toVersionDto(item.reviewVersion) : null,
  };
}

export function toDetailDto(detail: RopaDetail): RopaActivityDetailDto {
  const activity: RopaActivity = detail.activity;
  return {
    activityId: activity.id,
    slug: activity.slug,
    createdAt: activity.createdAt.toISOString(),
    updatedAt: activity.updatedAt.toISOString(),
    currentVersionId: activity.currentVersionId,
    versions: detail.versions.map(toVersionDto),
  };
}
