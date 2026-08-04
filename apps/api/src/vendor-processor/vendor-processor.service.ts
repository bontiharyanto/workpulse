import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Prisma,
  RopaActivityVendor,
  VendorProcessor,
  VendorCategory,
  VendorStatus,
} from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import {
  canBeActive,
  canTransition,
  computeInitialNextReviewAt,
  DEFAULT_REVIEW_INTERVAL_DAYS,
  addDays,
} from './domain/vendor-review-cadence';

/**
 * Fase 31f — CRUD + lifecycle service for the Vendor / Processor
 * Register.
 *
 * All mutations write to `AuditLog` inside the same transaction as
 * the state change so the DPO gets an unbroken provenance chain.
 * Business rules that are worth surfacing:
 *
 *   - `ACTIVE` requires a signed DPA (see `canBeActive`).
 *   - Status transitions honour the state machine in
 *     `vendor-review-cadence.ts`. `TERMINATED` is terminal — a
 *     re-signed vendor must create a fresh row.
 *   - Termination stamps `terminatedAt` + `terminatedReason` +
 *     `terminatedById` atomically.
 *   - `markReviewed` bumps `nextReviewAt` by the default cadence
 *     unless the caller supplied a custom date.
 */
export interface VendorCreateInput {
  slug: string;
  name: string;
  category: VendorCategory;
  description: string;
  dataCategories?: string[];
  personalDataVolume?: 'LOW' | 'MEDIUM' | 'HIGH' | 'MASSIVE';
  dataResidency?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contractDocumentUrl?: string | null;
  contractStartAt?: Date | null;
  contractEndAt?: Date | null;
  dpaSignedAt?: Date | null;
  subprocessorsAllowed?: boolean;
  securityCertifications?: string[];
  nextReviewAt?: Date;
}

export interface VendorUpdateInput extends Partial<VendorCreateInput> {
  status?: VendorStatus;
}

export interface VendorListQuery {
  status?: VendorStatus;
  category?: VendorCategory;
  cursor?: string;
  limit?: number;
}

export type VendorWithLinks = VendorProcessor & {
  ropaLinks: Array<
    RopaActivityVendor & {
      ropaActivity: { id: string; slug: string; currentVersion: { name: string } | null };
    }
  >;
  _count: { ropaLinks: number };
};

const INCLUDE_FULL = {
  ropaLinks: {
    include: {
      ropaActivity: {
        select: {
          id: true,
          slug: true,
          currentVersion: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  _count: { select: { ropaLinks: true } },
} satisfies Prisma.VendorProcessorInclude;

@Injectable()
export class VendorProcessorService {
  private readonly logger = new Logger(VendorProcessorService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------- Reads ----------

  async list(
    actor: AuthenticatedUser,
    query: VendorListQuery,
  ): Promise<{
    items: VendorWithLinks[];
    nextCursor: string | null;
  }> {
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const where: Prisma.VendorProcessorWhereInput = {
      companyId: actor.companyId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
    };
    const rows = await this.prisma.vendorProcessor.findMany({
      where,
      include: INCLUDE_FULL,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    return { items, nextCursor: hasMore && last ? last.id : null };
  }

  async detail(actor: AuthenticatedUser, id: string): Promise<VendorWithLinks> {
    const vendor = await this.prisma.vendorProcessor.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      include: INCLUDE_FULL,
    });
    if (!vendor) throw new NotFoundException('VENDOR_NOT_FOUND');
    return vendor;
  }

  // ---------- Mutations ----------

  async create(actor: AuthenticatedUser, body: VendorCreateInput): Promise<VendorWithLinks> {
    const now = new Date();
    const nextReviewAt =
      body.nextReviewAt ?? computeInitialNextReviewAt(now, body.contractStartAt ?? null);
    this.assertContractWindow(body.contractStartAt ?? null, body.contractEndAt ?? null);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const vendor = await tx.vendorProcessor.create({
          data: {
            companyId: actor.companyId,
            slug: body.slug.trim(),
            name: body.name.trim(),
            category: body.category,
            status: 'UNDER_REVIEW',
            description: body.description.trim(),
            dataCategories: normaliseTags(body.dataCategories ?? []),
            personalDataVolume: body.personalDataVolume ?? 'LOW',
            dataResidency: body.dataResidency ?? null,
            contactName: body.contactName ?? null,
            contactEmail: body.contactEmail ?? null,
            contactPhone: body.contactPhone ?? null,
            contractDocumentUrl: body.contractDocumentUrl ?? null,
            contractStartAt: body.contractStartAt ?? null,
            contractEndAt: body.contractEndAt ?? null,
            dpaSignedAt: body.dpaSignedAt ?? null,
            subprocessorsAllowed: body.subprocessorsAllowed ?? false,
            securityCertifications: normaliseTags(body.securityCertifications ?? []),
            nextReviewAt,
            createdById: actor.id,
            updatedById: actor.id,
          },
          include: INCLUDE_FULL,
        });

        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action: 'VENDOR_PROCESSOR_CREATED',
            entityType: 'VendorProcessor',
            entityId: vendor.id,
            afterJson: sanitiseForAudit({
              slug: vendor.slug,
              name: vendor.name,
              category: vendor.category,
              status: vendor.status,
              nextReviewAt: vendor.nextReviewAt.toISOString(),
            }),
          },
        });

        return vendor;
      });
      return created;
    } catch (err) {
      if (isPrismaError(err) && err.code === 'P2002') {
        throw new ConflictException('VENDOR_SLUG_TAKEN');
      }
      throw err;
    }
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    body: VendorUpdateInput,
  ): Promise<VendorWithLinks> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.vendorProcessor.findFirst({
        where: { id, companyId: actor.companyId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('VENDOR_NOT_FOUND');
      if (existing.status === 'TERMINATED') {
        throw new ConflictException('VENDOR_TERMINATED');
      }

      const nextStatus = body.status ?? existing.status;
      if (!canTransition(existing.status, nextStatus)) {
        throw new ConflictException('VENDOR_ILLEGAL_TRANSITION');
      }

      // Merge the incoming DPA sign date (if any) with the existing
      // one so the ACTIVE precondition is checked against the
      // ultimate state, not the request in isolation.
      const effectiveDpaSignedAt =
        body.dpaSignedAt !== undefined ? body.dpaSignedAt : existing.dpaSignedAt;
      if (nextStatus === 'ACTIVE' && !canBeActive(effectiveDpaSignedAt)) {
        throw new BadRequestException('VENDOR_DPA_REQUIRED');
      }

      const contractStartAt =
        body.contractStartAt !== undefined ? body.contractStartAt : existing.contractStartAt;
      const contractEndAt =
        body.contractEndAt !== undefined ? body.contractEndAt : existing.contractEndAt;
      this.assertContractWindow(contractStartAt, contractEndAt);

      const before = pickForAudit(existing);
      const updated = await tx.vendorProcessor.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(nextStatus !== existing.status ? { status: nextStatus } : {}),
          ...(body.description !== undefined ? { description: body.description.trim() } : {}),
          ...(body.dataCategories !== undefined
            ? { dataCategories: normaliseTags(body.dataCategories) }
            : {}),
          ...(body.personalDataVolume !== undefined
            ? { personalDataVolume: body.personalDataVolume }
            : {}),
          ...(body.dataResidency !== undefined ? { dataResidency: body.dataResidency } : {}),
          ...(body.contactName !== undefined ? { contactName: body.contactName } : {}),
          ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail } : {}),
          ...(body.contactPhone !== undefined ? { contactPhone: body.contactPhone } : {}),
          ...(body.contractDocumentUrl !== undefined
            ? { contractDocumentUrl: body.contractDocumentUrl }
            : {}),
          ...(body.contractStartAt !== undefined ? { contractStartAt: body.contractStartAt } : {}),
          ...(body.contractEndAt !== undefined ? { contractEndAt: body.contractEndAt } : {}),
          ...(body.dpaSignedAt !== undefined ? { dpaSignedAt: body.dpaSignedAt } : {}),
          ...(body.subprocessorsAllowed !== undefined
            ? { subprocessorsAllowed: body.subprocessorsAllowed }
            : {}),
          ...(body.securityCertifications !== undefined
            ? { securityCertifications: normaliseTags(body.securityCertifications) }
            : {}),
          ...(body.nextReviewAt !== undefined ? { nextReviewAt: body.nextReviewAt } : {}),
          updatedById: actor.id,
        },
        include: INCLUDE_FULL,
      });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action:
            nextStatus !== existing.status
              ? 'VENDOR_PROCESSOR_STATUS_CHANGED'
              : 'VENDOR_PROCESSOR_UPDATED',
          entityType: 'VendorProcessor',
          entityId: updated.id,
          beforeJson: sanitiseForAudit(before),
          afterJson: sanitiseForAudit(pickForAudit(updated)),
        },
      });

      return updated;
    });
  }

  async markReviewed(
    actor: AuthenticatedUser,
    id: string,
    note: string | null,
    nextReviewAt?: Date,
  ): Promise<VendorWithLinks> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.vendorProcessor.findFirst({
        where: { id, companyId: actor.companyId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('VENDOR_NOT_FOUND');
      if (existing.status === 'TERMINATED') {
        throw new ConflictException('VENDOR_TERMINATED');
      }

      const nextCutoff = nextReviewAt ?? addDays(now, DEFAULT_REVIEW_INTERVAL_DAYS);
      const updated = await tx.vendorProcessor.update({
        where: { id },
        data: {
          lastReviewedAt: now,
          lastReviewNote: note,
          nextReviewAt: nextCutoff,
          updatedById: actor.id,
        },
        include: INCLUDE_FULL,
      });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'VENDOR_PROCESSOR_REVIEWED',
          entityType: 'VendorProcessor',
          entityId: updated.id,
          afterJson: sanitiseForAudit({
            slug: updated.slug,
            lastReviewedAt: updated.lastReviewedAt?.toISOString() ?? null,
            nextReviewAt: updated.nextReviewAt.toISOString(),
          }),
        },
      });

      return updated;
    });
  }

  async terminate(actor: AuthenticatedUser, id: string, reason: string): Promise<VendorWithLinks> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.vendorProcessor.findFirst({
        where: { id, companyId: actor.companyId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('VENDOR_NOT_FOUND');
      if (existing.status === 'TERMINATED') {
        throw new ConflictException('VENDOR_ALREADY_TERMINATED');
      }
      if (!canTransition(existing.status, 'TERMINATED')) {
        throw new ConflictException('VENDOR_ILLEGAL_TRANSITION');
      }

      const before = pickForAudit(existing);
      const updated = await tx.vendorProcessor.update({
        where: { id },
        data: {
          status: 'TERMINATED',
          terminatedAt: now,
          terminatedReason: reason.trim(),
          terminatedById: actor.id,
          updatedById: actor.id,
        },
        include: INCLUDE_FULL,
      });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'VENDOR_PROCESSOR_TERMINATED',
          entityType: 'VendorProcessor',
          entityId: updated.id,
          beforeJson: sanitiseForAudit(before),
          afterJson: sanitiseForAudit({
            slug: updated.slug,
            status: updated.status,
            terminatedAt: updated.terminatedAt?.toISOString() ?? null,
            terminatedReason: updated.terminatedReason,
          }),
        },
      });

      return updated;
    });
  }

  // ---------- ROPA linking ----------

  async linkRopa(
    actor: AuthenticatedUser,
    vendorId: string,
    ropaActivityId: string,
    note: string | null,
  ): Promise<VendorWithLinks> {
    return this.prisma.$transaction(async (tx) => {
      const vendor = await tx.vendorProcessor.findFirst({
        where: { id: vendorId, companyId: actor.companyId, deletedAt: null },
      });
      if (!vendor) throw new NotFoundException('VENDOR_NOT_FOUND');

      const activity = await tx.ropaActivity.findFirst({
        where: { id: ropaActivityId, companyId: actor.companyId },
      });
      if (!activity) throw new NotFoundException('ROPA_ACTIVITY_NOT_FOUND');

      try {
        await tx.ropaActivityVendor.create({
          data: {
            ropaActivityId,
            vendorId,
            companyId: actor.companyId,
            note: note ?? null,
            createdById: actor.id,
          },
        });
      } catch (err) {
        if (isPrismaError(err) && err.code === 'P2002') {
          throw new ConflictException('VENDOR_ROPA_LINK_EXISTS');
        }
        throw err;
      }

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'VENDOR_PROCESSOR_ROPA_LINKED',
          entityType: 'VendorProcessor',
          entityId: vendorId,
          afterJson: sanitiseForAudit({ ropaActivityId, vendorId }),
        },
      });

      return tx.vendorProcessor.findFirstOrThrow({
        where: { id: vendorId, companyId: actor.companyId },
        include: INCLUDE_FULL,
      });
    });
  }

  async unlinkRopa(
    actor: AuthenticatedUser,
    vendorId: string,
    linkId: string,
  ): Promise<VendorWithLinks> {
    return this.prisma.$transaction(async (tx) => {
      const link = await tx.ropaActivityVendor.findFirst({
        where: { id: linkId, vendorId, companyId: actor.companyId },
      });
      if (!link) throw new NotFoundException('VENDOR_ROPA_LINK_NOT_FOUND');

      await tx.ropaActivityVendor.delete({ where: { id: linkId } });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'VENDOR_PROCESSOR_ROPA_UNLINKED',
          entityType: 'VendorProcessor',
          entityId: vendorId,
          beforeJson: sanitiseForAudit({
            linkId,
            ropaActivityId: link.ropaActivityId,
            vendorId,
          }),
        },
      });

      return tx.vendorProcessor.findFirstOrThrow({
        where: { id: vendorId, companyId: actor.companyId },
        include: INCLUDE_FULL,
      });
    });
  }

  // ---------- Utilities ----------

  private assertContractWindow(start: Date | null, end: Date | null): void {
    if (start && end && end.getTime() <= start.getTime()) {
      throw new BadRequestException('VENDOR_CONTRACT_WINDOW_INVALID');
    }
  }
}

// ---------- helpers ----------

function normaliseTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const trimmed = t.trim();
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function pickForAudit(v: VendorProcessor): Record<string, unknown> {
  return {
    slug: v.slug,
    name: v.name,
    category: v.category,
    status: v.status,
    personalDataVolume: v.personalDataVolume,
    contractStartAt: v.contractStartAt?.toISOString() ?? null,
    contractEndAt: v.contractEndAt?.toISOString() ?? null,
    dpaSignedAt: v.dpaSignedAt?.toISOString() ?? null,
    nextReviewAt: v.nextReviewAt.toISOString(),
    subprocessorsAllowed: v.subprocessorsAllowed,
  };
}

function sanitiseForAudit(input: Record<string, unknown>): Prisma.InputJsonValue {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = v === undefined ? null : v;
  }
  return out as Prisma.InputJsonValue;
}

function isPrismaError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}
