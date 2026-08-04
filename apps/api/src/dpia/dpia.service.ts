import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DpiaAssessment, DpiaRiskItem, DpiaStatus, Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  InvalidRiskAxisError,
  ResidualExceedsInherentError,
  deriveRisk,
  summariseResidual,
} from './domain/risk-scoring';
import {
  DpiaTransition,
  IllegalDpiaTransitionError,
  isEditable,
  transition,
} from './domain/state-machine';

interface CreateAssessmentInput {
  ropaActivityId: string;
  title: string;
  scope: string;
  necessity: string;
  dpoOpinion?: string;
}

interface UpdateAssessmentInput {
  title?: string;
  scope?: string;
  necessity?: string;
  dpoOpinion?: string | null;
  conclusion?: string | null;
}

interface CreateRiskItemInput {
  title: string;
  description: string;
  likelihood: number;
  impact: number;
  mitigations: string;
  residualLikelihood: number;
  residualImpact: number;
}

interface UpdateRiskItemInput {
  title?: string;
  description?: string;
  likelihood?: number;
  impact?: number;
  mitigations?: string;
  residualLikelihood?: number;
  residualImpact?: number;
}

type AssessmentWithItems = DpiaAssessment & { riskItems: DpiaRiskItem[] };

/**
 * Fase 31e — DPIA CRUD + lifecycle service.
 *
 * Every mutation writes an `AuditLog` row inside the same
 * `$transaction` as the underlying write, matching the ROPA pattern
 * (ADR-0030). Consequences of a broken audit trail are enough to
 * warrant the extra round-trip.
 *
 * Tenant scoping: every read/write is filtered by
 * `actor.companyId`. Cross-tenant access is a bug, not a business
 * decision — HR from tenant A must never see tenant B's risk register.
 */
@Injectable()
export class DpiaService {
  private readonly logger = new Logger(DpiaService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------- Reads --------

  async list(actor: AuthenticatedUser) {
    return this.prisma.dpiaAssessment.findMany({
      where: { companyId: actor.companyId },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      include: {
        riskItems: { orderBy: { ordinal: 'asc' } },
        ropaActivity: {
          select: {
            slug: true,
            currentVersion: { select: { name: true } },
          },
        },
      },
    });
  }

  async detail(actor: AuthenticatedUser, id: string): Promise<AssessmentWithItems> {
    const row = await this.prisma.dpiaAssessment.findFirst({
      where: { id, companyId: actor.companyId },
      include: { riskItems: { orderBy: { ordinal: 'asc' } } },
    });
    if (!row) throw new NotFoundException('DPIA_NOT_FOUND');
    return row;
  }

  /**
   * All APPROVED DPIAs — used by the export renderer and by ROPA
   * detail pages that want to surface "linked DPIA".
   */
  async listApproved(companyId: string): Promise<AssessmentWithItems[]> {
    return this.prisma.dpiaAssessment.findMany({
      where: { companyId, status: 'APPROVED' },
      orderBy: { approvedAt: 'desc' },
      include: { riskItems: { orderBy: { ordinal: 'asc' } } },
    });
  }

  // -------- Assessment writes --------

  async createAssessment(
    actor: AuthenticatedUser,
    input: CreateAssessmentInput,
  ): Promise<AssessmentWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const activity = await tx.ropaActivity.findFirst({
        where: { id: input.ropaActivityId, companyId: actor.companyId },
        select: { id: true, slug: true },
      });
      if (!activity) {
        throw new BadRequestException('ROPA_ACTIVITY_NOT_FOUND');
      }

      const created = await tx.dpiaAssessment.create({
        data: {
          companyId: actor.companyId,
          ropaActivityId: activity.id,
          title: input.title.trim(),
          scope: input.scope.trim(),
          necessity: input.necessity.trim(),
          dpoOpinion: input.dpoOpinion?.trim() ?? null,
          createdById: actor.id,
        },
        include: { riskItems: true },
      });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'DPIA_CREATED',
          entityType: 'DpiaAssessment',
          entityId: created.id,
          afterJson: {
            ropaActivityId: activity.id,
            slug: activity.slug,
            title: created.title,
          } as Prisma.InputJsonValue,
        },
      });

      return created;
    });
  }

  async updateAssessment(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateAssessmentInput,
  ): Promise<AssessmentWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.loadForUpdate(tx, actor.companyId, id);
      if (!isEditable(current.status)) {
        throw new ConflictException('DPIA_NOT_EDITABLE');
      }
      const patch: Prisma.DpiaAssessmentUncheckedUpdateInput = {};
      if (input.title !== undefined) patch.title = input.title.trim();
      if (input.scope !== undefined) patch.scope = input.scope.trim();
      if (input.necessity !== undefined) patch.necessity = input.necessity.trim();
      if (input.dpoOpinion !== undefined) {
        patch.dpoOpinion = input.dpoOpinion?.trim() || null;
      }
      if (input.conclusion !== undefined) {
        patch.conclusion = input.conclusion?.trim() || null;
      }
      const updated = await tx.dpiaAssessment.update({
        where: { id: current.id },
        data: patch,
        include: { riskItems: { orderBy: { ordinal: 'asc' } } },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'DPIA_UPDATED',
          entityType: 'DpiaAssessment',
          entityId: updated.id,
          afterJson: (patch as unknown as Prisma.InputJsonValue) ?? null,
        },
      });
      return updated;
    });
  }

  async submitReview(actor: AuthenticatedUser, id: string): Promise<AssessmentWithItems> {
    return this.applyTransition(actor, id, 'SUBMIT_REVIEW', {
      reviewedById: actor.id,
      reviewedAt: new Date(),
    });
  }

  async returnToDraft(actor: AuthenticatedUser, id: string): Promise<AssessmentWithItems> {
    return this.applyTransition(actor, id, 'RETURN_TO_DRAFT', {
      // Clear the review provenance — the DPO must re-submit fresh.
      reviewedById: null,
      reviewedAt: null,
    });
  }

  async approve(actor: AuthenticatedUser, id: string): Promise<AssessmentWithItems> {
    // Approving requires the register to have at least one risk item —
    // otherwise the DPIA is meaningless as compliance evidence.
    return this.prisma.$transaction(async (tx) => {
      const current = await this.loadForUpdate(tx, actor.companyId, id);
      if (current.status !== DpiaStatus.REVIEW) {
        throw new ConflictException('DPIA_NOT_IN_REVIEW');
      }
      const count = await tx.dpiaRiskItem.count({
        where: { assessmentId: current.id },
      });
      if (count === 0) {
        throw new BadRequestException('DPIA_HAS_NO_RISK_ITEMS');
      }

      // Auto-archive any previous APPROVED for the same activity so the
      // partial unique index (`one_approved_per_activity`) is never
      // violated. Kept inside the same tx as the approve write so a
      // crash leaves the DB consistent.
      await tx.dpiaAssessment.updateMany({
        where: {
          companyId: actor.companyId,
          ropaActivityId: current.ropaActivityId,
          status: DpiaStatus.APPROVED,
        },
        data: {
          status: DpiaStatus.ARCHIVED,
          archivedAt: new Date(),
        },
      });

      const nextStatus = transition(current.status, 'APPROVE');
      const approved = await tx.dpiaAssessment.update({
        where: { id: current.id },
        data: {
          status: nextStatus,
          approvedById: actor.id,
          approvedAt: new Date(),
        },
        include: { riskItems: { orderBy: { ordinal: 'asc' } } },
      });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'DPIA_APPROVED',
          entityType: 'DpiaAssessment',
          entityId: approved.id,
          beforeJson: { status: current.status } as Prisma.InputJsonValue,
          afterJson: { status: approved.status } as Prisma.InputJsonValue,
        },
      });
      return approved;
    });
  }

  // -------- Risk items --------

  async addRiskItem(
    actor: AuthenticatedUser,
    assessmentId: string,
    input: CreateRiskItemInput,
  ): Promise<AssessmentWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const assessment = await this.loadForUpdate(tx, actor.companyId, assessmentId);
      if (!isEditable(assessment.status)) {
        throw new ConflictException('DPIA_NOT_EDITABLE');
      }
      let derived;
      try {
        derived = deriveRisk({
          likelihood: input.likelihood,
          impact: input.impact,
          residualLikelihood: input.residualLikelihood,
          residualImpact: input.residualImpact,
        });
      } catch (err) {
        this.rethrowDomain(err);
      }

      const maxOrdinal = await tx.dpiaRiskItem.aggregate({
        where: { assessmentId },
        _max: { ordinal: true },
      });
      const nextOrdinal = (maxOrdinal._max.ordinal ?? 0) + 1;

      const created = await tx.dpiaRiskItem.create({
        data: {
          companyId: actor.companyId,
          assessmentId,
          ordinal: nextOrdinal,
          title: input.title.trim(),
          description: input.description.trim(),
          likelihood: input.likelihood,
          impact: input.impact,
          inherentLevel: derived.inherentLevel,
          mitigations: input.mitigations.trim(),
          residualLikelihood: input.residualLikelihood,
          residualImpact: input.residualImpact,
          residualLevel: derived.residualLevel,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'DPIA_RISK_ADDED',
          entityType: 'DpiaRiskItem',
          entityId: created.id,
          afterJson: {
            assessmentId,
            ordinal: created.ordinal,
            title: created.title,
            residualLevel: derived.residualLevel,
          } as Prisma.InputJsonValue,
        },
      });

      return this.reload(tx, actor.companyId, assessmentId);
    });
  }

  async updateRiskItem(
    actor: AuthenticatedUser,
    assessmentId: string,
    riskItemId: string,
    input: UpdateRiskItemInput,
  ): Promise<AssessmentWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const assessment = await this.loadForUpdate(tx, actor.companyId, assessmentId);
      if (!isEditable(assessment.status)) {
        throw new ConflictException('DPIA_NOT_EDITABLE');
      }
      const existing = await tx.dpiaRiskItem.findFirst({
        where: {
          id: riskItemId,
          assessmentId,
          companyId: actor.companyId,
        },
      });
      if (!existing) throw new NotFoundException('DPIA_RISK_NOT_FOUND');

      const likelihood = input.likelihood ?? existing.likelihood;
      const impact = input.impact ?? existing.impact;
      const residualLikelihood = input.residualLikelihood ?? existing.residualLikelihood;
      const residualImpact = input.residualImpact ?? existing.residualImpact;

      let derived;
      try {
        derived = deriveRisk({
          likelihood,
          impact,
          residualLikelihood,
          residualImpact,
        });
      } catch (err) {
        this.rethrowDomain(err);
      }

      const patch: Prisma.DpiaRiskItemUncheckedUpdateInput = {
        likelihood,
        impact,
        inherentLevel: derived.inherentLevel,
        residualLikelihood,
        residualImpact,
        residualLevel: derived.residualLevel,
      };
      if (input.title !== undefined) patch.title = input.title.trim();
      if (input.description !== undefined) patch.description = input.description.trim();
      if (input.mitigations !== undefined) patch.mitigations = input.mitigations.trim();

      await tx.dpiaRiskItem.update({ where: { id: riskItemId }, data: patch });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'DPIA_RISK_UPDATED',
          entityType: 'DpiaRiskItem',
          entityId: riskItemId,
          afterJson: {
            ordinal: existing.ordinal,
            residualLevel: derived.residualLevel,
          } as Prisma.InputJsonValue,
        },
      });

      return this.reload(tx, actor.companyId, assessmentId);
    });
  }

  async removeRiskItem(
    actor: AuthenticatedUser,
    assessmentId: string,
    riskItemId: string,
  ): Promise<AssessmentWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const assessment = await this.loadForUpdate(tx, actor.companyId, assessmentId);
      if (!isEditable(assessment.status)) {
        throw new ConflictException('DPIA_NOT_EDITABLE');
      }
      const item = await tx.dpiaRiskItem.findFirst({
        where: { id: riskItemId, assessmentId, companyId: actor.companyId },
      });
      if (!item) throw new NotFoundException('DPIA_RISK_NOT_FOUND');
      await tx.dpiaRiskItem.delete({ where: { id: riskItemId } });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'DPIA_RISK_REMOVED',
          entityType: 'DpiaRiskItem',
          entityId: riskItemId,
          beforeJson: {
            ordinal: item.ordinal,
            title: item.title,
          } as Prisma.InputJsonValue,
        },
      });
      return this.reload(tx, actor.companyId, assessmentId);
    });
  }

  // -------- Utilities --------

  static summaryOf(a: AssessmentWithItems) {
    return summariseResidual(a.riskItems);
  }

  private async applyTransition(
    actor: AuthenticatedUser,
    id: string,
    action: DpiaTransition,
    extra: Prisma.DpiaAssessmentUncheckedUpdateInput = {},
  ): Promise<AssessmentWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.loadForUpdate(tx, actor.companyId, id);
      let next: DpiaStatus;
      try {
        next = transition(current.status, action);
      } catch (err) {
        if (err instanceof IllegalDpiaTransitionError) {
          throw new ConflictException('DPIA_ILLEGAL_TRANSITION');
        }
        throw err;
      }
      const updated = await tx.dpiaAssessment.update({
        where: { id: current.id },
        data: { status: next, ...extra },
        include: { riskItems: { orderBy: { ordinal: 'asc' } } },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: `DPIA_${action}`,
          entityType: 'DpiaAssessment',
          entityId: updated.id,
          beforeJson: { status: current.status } as Prisma.InputJsonValue,
          afterJson: { status: updated.status } as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
  }

  private async loadForUpdate(
    tx: Prisma.TransactionClient,
    companyId: string,
    id: string,
  ): Promise<AssessmentWithItems> {
    const row = await tx.dpiaAssessment.findFirst({
      where: { id, companyId },
      include: { riskItems: { orderBy: { ordinal: 'asc' } } },
    });
    if (!row) throw new NotFoundException('DPIA_NOT_FOUND');
    return row;
  }

  private async reload(
    tx: Prisma.TransactionClient,
    companyId: string,
    id: string,
  ): Promise<AssessmentWithItems> {
    return this.loadForUpdate(tx, companyId, id);
  }

  private rethrowDomain(err: unknown): never {
    if (err instanceof ResidualExceedsInherentError) {
      throw new BadRequestException('DPIA_RESIDUAL_EXCEEDS_INHERENT');
    }
    if (err instanceof InvalidRiskAxisError) {
      throw new BadRequestException('DPIA_RISK_AXIS_OUT_OF_RANGE');
    }
    this.logger.error(`DPIA domain error: ${(err as Error).message}`);
    throw err;
  }
}
