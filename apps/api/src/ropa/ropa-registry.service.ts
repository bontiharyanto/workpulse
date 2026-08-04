import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Prisma,
  RopaActivity,
  RopaActivityVersion,
  RopaLegalBasis,
  RopaVersionStatus,
} from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import {
  IllegalRopaTransitionError,
  isEditable,
  transition,
} from './domain/version-state-machine';
import { ROPA_SEED_BLUEPRINTS } from './domain/seed-catalogue';

/**
 * The Art. 30 GDPR / Pasal 31 UU PDP fields a caller may set on a
 * DRAFT version. Kept separate from Prisma's raw update type so the
 * service can validate + defensively pick fields (never blindly spread
 * an untrusted body).
 */
export interface RopaVersionPatch {
  name?: string;
  purpose?: string;
  legalBasis?: RopaLegalBasis;
  legalBasisDetail?: string | null;
  dataCategories?: string[];
  subjectCategories?: string[];
  recipients?: string[];
  retentionPeriod?: string;
  crossBorderTransfer?: boolean;
  crossBorderDetail?: string | null;
  securityMeasures?: string;
  notes?: string | null;
}

/** Full body accepted at CREATE time (all mandatory fields must be present). */
export interface RopaVersionCreate {
  slug: string;
  name: string;
  purpose: string;
  legalBasis: RopaLegalBasis;
  legalBasisDetail?: string | null;
  dataCategories: string[];
  subjectCategories: string[];
  recipients: string[];
  retentionPeriod: string;
  crossBorderTransfer: boolean;
  crossBorderDetail?: string | null;
  securityMeasures: string;
  notes?: string | null;
}

export interface RopaListItem {
  activityId: string;
  slug: string;
  currentVersion: RopaActivityVersion | null;
  draftVersion: RopaActivityVersion | null;
  reviewVersion: RopaActivityVersion | null;
}

export interface RopaDetail {
  activity: RopaActivity;
  versions: RopaActivityVersion[];
}

/**
 * Fase 31d — Record of Processing Activities registry.
 *
 * Design invariants:
 *
 *   - **Only DRAFT is editable.** REVIEW / PUBLISHED / ARCHIVED rows are
 *     frozen; a mistake requires opening a *new* DRAFT (via `newVersion`)
 *     and republishing. This is what makes the audit trail credible.
 *   - **Exactly one PUBLISHED per activity.** Publishing a new version
 *     runs in a `$transaction` that both flips the target to PUBLISHED
 *     and archives the previous PUBLISHED. `RopaActivity.currentVersionId`
 *     is updated in the same tx so a reader never sees a mid-publish
 *     "two-published" state.
 *   - **Idempotent seed.** Re-running `seedDefaults` for a tenant that
 *     already has, say, `attendance-tracking`, is a no-op for that slug.
 *     The unique index `(companyId, slug)` guarantees this at the DB
 *     level too.
 *   - **Every mutation writes AuditLog inline.** No dangling "record was
 *     modified" mystery.
 */
@Injectable()
export class RopaRegistryService {
  private readonly logger = new Logger(RopaRegistryService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(actor: AuthenticatedUser): Promise<RopaListItem[]> {
    const activities = await this.prisma.ropaActivity.findMany({
      where: { companyId: actor.companyId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
        },
      },
      orderBy: { slug: 'asc' },
    });

    return activities.map((activity) => {
      // Pull the most useful three versions for the list view.
      const current = activity.versions.find((v) => v.status === 'PUBLISHED') ?? null;
      const draft = activity.versions.find((v) => v.status === 'DRAFT') ?? null;
      const review = activity.versions.find((v) => v.status === 'REVIEW') ?? null;
      return {
        activityId: activity.id,
        slug: activity.slug,
        currentVersion: current,
        draftVersion: draft,
        reviewVersion: review,
      };
    });
  }

  async detail(
    actor: AuthenticatedUser,
    activityId: string,
  ): Promise<RopaDetail> {
    const activity = await this.prisma.ropaActivity.findFirst({
      where: { id: activityId, companyId: actor.companyId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
        },
      },
    });
    if (!activity) throw new NotFoundException('ROPA_ACTIVITY_NOT_FOUND');
    // Split off the versions so the caller has a clean `activity` shape.
    const { versions, ...rest } = activity;
    return {
      activity: rest as RopaActivity,
      versions,
    };
  }

  async listPublishedForExport(companyId: string): Promise<
    Array<RopaActivityVersion & { activity: { slug: string } }>
  > {
    return this.prisma.ropaActivityVersion.findMany({
      where: { companyId, status: 'PUBLISHED' },
      include: { activity: { select: { slug: true } } },
      orderBy: [{ activity: { slug: 'asc' } }],
    });
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  /**
   * Create a brand-new activity + version 1 DRAFT. Slug must be unique
   * per tenant (P2002 mapped to a 409). Used by the seed helper too — a
   * single code-path so we can't diverge on validation.
   */
  async createActivity(
    actor: AuthenticatedUser,
    body: RopaVersionCreate,
  ): Promise<RopaActivityVersion> {
    const slug = normaliseSlug(body.slug);
    return this.prisma.$transaction(async (tx) => {
      let activity: RopaActivity;
      try {
        activity = await tx.ropaActivity.create({
          data: {
            companyId: actor.companyId,
            slug,
          },
        });
      } catch (err) {
        if (
          isPrismaError(err) &&
          (err as { code?: string }).code === 'P2002'
        ) {
          throw new ConflictException({
            statusCode: 409,
            code: 'ROPA_SLUG_TAKEN',
            message: `Aktivitas dengan slug "${slug}" sudah ada di tenant ini.`,
          });
        }
        throw err;
      }

      const version = await tx.ropaActivityVersion.create({
        data: {
          activityId: activity.id,
          companyId: actor.companyId,
          version: 1,
          status: 'DRAFT',
          name: body.name.trim(),
          purpose: body.purpose.trim(),
          legalBasis: body.legalBasis,
          legalBasisDetail: nullableTrim(body.legalBasisDetail),
          dataCategories: normaliseTags(body.dataCategories),
          subjectCategories: normaliseTags(body.subjectCategories),
          recipients: normaliseTags(body.recipients),
          retentionPeriod: body.retentionPeriod.trim(),
          crossBorderTransfer: body.crossBorderTransfer,
          crossBorderDetail: nullableTrim(body.crossBorderDetail),
          securityMeasures: body.securityMeasures.trim(),
          notes: nullableTrim(body.notes),
          createdById: actor.id,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'ROPA_VERSION_CREATED',
          entityType: 'RopaActivityVersion',
          entityId: version.id,
          afterJson: sanitiseForAudit({
            activityId: activity.id,
            slug,
            version: version.version,
            status: version.status,
            name: version.name,
          }),
        },
      });

      return version;
    });
  }

  /**
   * Idempotently seed the six built-in activities for a tenant. Blueprints
   * with an existing slug are skipped (not overwritten) so re-running the
   * helper is safe. Returns the list of freshly-created version ids so the
   * caller can surface a "seeded 4 of 6 (2 already existed)" toast.
   */
  async seedDefaults(actor: AuthenticatedUser): Promise<{
    created: string[];
    skipped: string[];
  }> {
    const created: string[] = [];
    const skipped: string[] = [];

    for (const blueprint of ROPA_SEED_BLUEPRINTS) {
      const existing = await this.prisma.ropaActivity.findUnique({
        where: {
          companyId_slug: {
            companyId: actor.companyId,
            slug: blueprint.slug,
          },
        },
        select: { id: true },
      });
      if (existing) {
        skipped.push(blueprint.slug);
        continue;
      }
      const version = await this.createActivity(actor, {
        slug: blueprint.slug,
        name: blueprint.name,
        purpose: blueprint.purpose,
        legalBasis: blueprint.legalBasis,
        legalBasisDetail: blueprint.legalBasisDetail,
        dataCategories: blueprint.dataCategories.slice(),
        subjectCategories: blueprint.subjectCategories.slice(),
        recipients: blueprint.recipients.slice(),
        retentionPeriod: blueprint.retentionPeriod,
        crossBorderTransfer: blueprint.crossBorderTransfer,
        crossBorderDetail: blueprint.crossBorderDetail,
        securityMeasures: blueprint.securityMeasures,
        notes: blueprint.notes,
      });
      created.push(version.id);
    }

    return { created, skipped };
  }

  /**
   * Patch a DRAFT version. Refuses on any non-DRAFT status (mirrors the
   * state machine's `isEditable` guard). Only fields present in `patch`
   * are touched — a missing key means "leave as-is".
   */
  async patchVersion(
    actor: AuthenticatedUser,
    activityId: string,
    versionId: string,
    patch: RopaVersionPatch,
  ): Promise<RopaActivityVersion> {
    const version = await this.loadVersion(actor.companyId, activityId, versionId);
    if (!isEditable(version.status)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'ROPA_NOT_EDITABLE',
        message: `Versi ini berstatus ${version.status} dan tidak bisa di-edit. Buat versi baru untuk mengubah.`,
      });
    }

    const data: Prisma.RopaActivityVersionUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name.trim();
    if (patch.purpose !== undefined) data.purpose = patch.purpose.trim();
    if (patch.legalBasis !== undefined) data.legalBasis = patch.legalBasis;
    if (patch.legalBasisDetail !== undefined)
      data.legalBasisDetail = nullableTrim(patch.legalBasisDetail);
    if (patch.dataCategories !== undefined)
      data.dataCategories = { set: normaliseTags(patch.dataCategories) };
    if (patch.subjectCategories !== undefined)
      data.subjectCategories = { set: normaliseTags(patch.subjectCategories) };
    if (patch.recipients !== undefined)
      data.recipients = { set: normaliseTags(patch.recipients) };
    if (patch.retentionPeriod !== undefined)
      data.retentionPeriod = patch.retentionPeriod.trim();
    if (patch.crossBorderTransfer !== undefined)
      data.crossBorderTransfer = patch.crossBorderTransfer;
    if (patch.crossBorderDetail !== undefined)
      data.crossBorderDetail = nullableTrim(patch.crossBorderDetail);
    if (patch.securityMeasures !== undefined)
      data.securityMeasures = patch.securityMeasures.trim();
    if (patch.notes !== undefined) data.notes = nullableTrim(patch.notes);

    if (Object.keys(data).length === 0) {
      // No-op patch — still return the current row (idempotent).
      return version;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.ropaActivityVersion.update({
        where: { id: versionId },
        data,
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'ROPA_VERSION_UPDATED',
          entityType: 'RopaActivityVersion',
          entityId: updated.id,
          beforeJson: sanitiseForAudit({
            name: version.name,
            purpose: version.purpose,
            legalBasis: version.legalBasis,
          }),
          afterJson: sanitiseForAudit({
            name: updated.name,
            purpose: updated.purpose,
            legalBasis: updated.legalBasis,
            changedKeys: Object.keys(data),
          }),
        },
      });
      return updated;
    });
  }

  /** DRAFT → REVIEW. */
  async submitReview(
    actor: AuthenticatedUser,
    activityId: string,
    versionId: string,
  ): Promise<RopaActivityVersion> {
    return this.applyStatusTransition(
      actor,
      activityId,
      versionId,
      'SUBMIT_REVIEW',
      'ROPA_VERSION_SUBMITTED',
      { reviewedById: actor.id, reviewedAt: new Date() },
    );
  }

  /** REVIEW → DRAFT (kick back for edits). */
  async returnToDraft(
    actor: AuthenticatedUser,
    activityId: string,
    versionId: string,
  ): Promise<RopaActivityVersion> {
    return this.applyStatusTransition(
      actor,
      activityId,
      versionId,
      'RETURN_TO_DRAFT',
      'ROPA_VERSION_RETURNED',
      { reviewedById: null, reviewedAt: null },
    );
  }

  /**
   * REVIEW → PUBLISHED. Simultaneously archives the previous PUBLISHED
   * (if any) and points `RopaActivity.currentVersionId` at the new row.
   * All three writes happen inside one `$transaction`.
   */
  async publish(
    actor: AuthenticatedUser,
    activityId: string,
    versionId: string,
  ): Promise<RopaActivityVersion> {
    const version = await this.loadVersion(actor.companyId, activityId, versionId);
    const nextStatus = this.applyStateMachine(version.status, 'PUBLISH');
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // Archive the previous PUBLISHED, if any.
      const previous = await tx.ropaActivityVersion.findFirst({
        where: {
          activityId,
          status: 'PUBLISHED',
          NOT: { id: versionId },
        },
      });
      if (previous) {
        await tx.ropaActivityVersion.update({
          where: { id: previous.id },
          data: { status: 'ARCHIVED', archivedAt: now },
        });
        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action: 'ROPA_VERSION_ARCHIVED',
            entityType: 'RopaActivityVersion',
            entityId: previous.id,
            beforeJson: sanitiseForAudit({
              status: 'PUBLISHED',
              version: previous.version,
            }),
            afterJson: sanitiseForAudit({
              status: 'ARCHIVED',
              archivedAt: now.toISOString(),
              supersededByVersionId: versionId,
            }),
          },
        });
      }

      const published = await tx.ropaActivityVersion.update({
        where: { id: versionId },
        data: {
          status: nextStatus,
          publishedById: actor.id,
          publishedAt: now,
        },
      });

      // Point the activity at the new current version. `currentVersionId`
      // has a UNIQUE constraint so this doubles as a concurrency guard.
      await tx.ropaActivity.update({
        where: { id: activityId },
        data: { currentVersionId: published.id },
      });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'ROPA_VERSION_PUBLISHED',
          entityType: 'RopaActivityVersion',
          entityId: published.id,
          beforeJson: sanitiseForAudit({ status: version.status }),
          afterJson: sanitiseForAudit({
            status: nextStatus,
            publishedAt: now.toISOString(),
            supersededPreviousId: previous?.id ?? null,
          }),
        },
      });

      return published;
    });
  }

  /**
   * Start a new DRAFT version for an activity that already has (or had)
   * a PUBLISHED row. Copies the field values from `currentVersion` (or
   * the latest ARCHIVED as fallback) so DPO doesn't retype the whole thing.
   */
  async newVersion(
    actor: AuthenticatedUser,
    activityId: string,
  ): Promise<RopaActivityVersion> {
    const activity = await this.prisma.ropaActivity.findFirst({
      where: { id: activityId, companyId: actor.companyId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
        },
      },
    });
    if (!activity) throw new NotFoundException('ROPA_ACTIVITY_NOT_FOUND');

    // Refuse if an active DRAFT / REVIEW already exists — the DPO should
    // finish that one first rather than fork a parallel edit history.
    const openVersion = activity.versions.find(
      (v) => v.status === 'DRAFT' || v.status === 'REVIEW',
    );
    if (openVersion) {
      throw new ConflictException({
        statusCode: 409,
        code: 'ROPA_OPEN_VERSION_EXISTS',
        message:
          'Sudah ada versi DRAFT / REVIEW yang belum di-publish. Selesaikan atau hapus versi tersebut sebelum membuka yang baru.',
      });
    }

    const seed = activity.versions[0]; // most recent (PUBLISHED or ARCHIVED)
    if (!seed) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'ROPA_NO_SEED_VERSION',
        message:
          'Tidak ada versi sebelumnya untuk dijadikan template. Gunakan `POST /admin/ropa/activities` untuk membuat versi pertama.',
      });
    }
    const nextVersion =
      Math.max(0, ...activity.versions.map((v) => v.version)) + 1;

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.ropaActivityVersion.create({
        data: {
          activityId,
          companyId: actor.companyId,
          version: nextVersion,
          status: 'DRAFT',
          name: seed.name,
          purpose: seed.purpose,
          legalBasis: seed.legalBasis,
          legalBasisDetail: seed.legalBasisDetail,
          dataCategories: seed.dataCategories.slice(),
          subjectCategories: seed.subjectCategories.slice(),
          recipients: seed.recipients.slice(),
          retentionPeriod: seed.retentionPeriod,
          crossBorderTransfer: seed.crossBorderTransfer,
          crossBorderDetail: seed.crossBorderDetail,
          securityMeasures: seed.securityMeasures,
          notes: seed.notes,
          createdById: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'ROPA_VERSION_CREATED',
          entityType: 'RopaActivityVersion',
          entityId: created.id,
          afterJson: sanitiseForAudit({
            activityId,
            version: created.version,
            status: created.status,
            forkedFromVersionId: seed.id,
          }),
        },
      });
      return created;
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async loadVersion(
    companyId: string,
    activityId: string,
    versionId: string,
  ): Promise<RopaActivityVersion> {
    const row = await this.prisma.ropaActivityVersion.findFirst({
      where: {
        id: versionId,
        activityId,
        companyId,
      },
    });
    if (!row) throw new NotFoundException('ROPA_VERSION_NOT_FOUND');
    return row;
  }

  private applyStateMachine(
    from: RopaVersionStatus,
    action: Parameters<typeof transition>[1],
  ): RopaVersionStatus {
    try {
      return transition(from, action);
    } catch (err) {
      if (err instanceof IllegalRopaTransitionError) {
        throw new ConflictException({
          statusCode: 409,
          code: 'ROPA_ILLEGAL_TRANSITION',
          message: `Versi berstatus ${err.from} tidak bisa menjalani ${err.attempted}.`,
        });
      }
      throw err;
    }
  }

  private async applyStatusTransition(
    actor: AuthenticatedUser,
    activityId: string,
    versionId: string,
    action: Parameters<typeof transition>[1],
    auditAction: string,
    extra: Prisma.RopaActivityVersionUncheckedUpdateInput,
  ): Promise<RopaActivityVersion> {
    const version = await this.loadVersion(actor.companyId, activityId, versionId);
    const nextStatus = this.applyStateMachine(version.status, action);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.ropaActivityVersion.update({
        where: { id: versionId },
        data: { status: nextStatus, ...extra },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: auditAction,
          entityType: 'RopaActivityVersion',
          entityId: updated.id,
          beforeJson: sanitiseForAudit({ status: version.status }),
          afterJson: sanitiseForAudit({ status: nextStatus }),
        },
      });
      return updated;
    });
  }
}

// ---------------------- Helpers ----------------------

function normaliseSlug(input: string): string {
  const s = input.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(s)) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'ROPA_SLUG_INVALID',
      message:
        'Slug harus 2..64 karakter, hanya lowercase huruf/angka/tanda hubung, dan tidak diawali tanda hubung.',
    });
  }
  return s;
}

function normaliseTags(tags: string[]): string[] {
  // Trim + drop empties + dedupe (case-preserving).
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const v = t.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function nullableTrim(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function sanitiseForAudit(input: Record<string, unknown>): Prisma.InputJsonValue {
  // Prisma JSON columns reject `undefined` values — flatten them to null.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = v === undefined ? null : v;
  }
  return out as Prisma.InputJsonValue;
}

function isPrismaError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}
