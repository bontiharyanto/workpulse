import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, SecurityPolicy } from '@prisma/client';
import { LOCATION_SHARING_CONSENT_COPY } from '@workpulse/shared-types';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Tenant-scoped security policy layer.
 *
 * # Responsibilities
 *
 * 1. Lazily materialise a `SecurityPolicy` row on first read (fresh
 *    tenants get sane defaults without a bootstrap migration).
 * 2. Serve the row to guards + admin controllers with a short-TTL
 *    in-process cache so a policy toggle takes effect within seconds
 *    across the whole API without any explicit invalidation call
 *    from the controller (single-replica happy path). Multi-replica
 *    deployments naturally converge within `POLICY_CACHE_TTL_MS`.
 * 3. Emit an immutable audit row inside the update transaction so
 *    every policy change is traceable.
 *
 * # Env fallback (bootstrap only)
 *
 * The legacy env `MFA_ENFORCE_HR_ADMIN` is consulted **only** when a
 * `SecurityPolicy` row is first created for a tenant. Once persisted,
 * the DB is authoritative — flipping the env has no effect until the
 * row is deleted.
 */
export type SecurityPolicyLocationSharingAction =
  | {
      action: 'ENABLE';
      /** APPROVED DpiaAssessment.id for activity=LOCATION_SHARING. */
      dpiaId: string;
      /** SHA-256 hex digest of the consent copy the tenant approved. */
      consentCopySha: string;
    }
  | { action: 'DISABLE' };

export interface SecurityPolicyUpdate {
  mfaEnforceHighPrivileged?: boolean;
  locationSharing?: SecurityPolicyLocationSharingAction;
}

interface CachedPolicy {
  policy: SecurityPolicy;
  expiresAt: number;
}

const POLICY_CACHE_TTL_MS = 30_000;

@Injectable()
export class SecurityPolicyService {
  private readonly logger = new Logger(SecurityPolicyService.name);
  private readonly cache = new Map<string, CachedPolicy>();
  private readonly envDefaultMfaEnforce: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    // Bootstrap-only fallback. Runtime toggles all flow through the
    // per-tenant row — see class-level comment.
    this.envDefaultMfaEnforce = config.get<string>('MFA_ENFORCE_HR_ADMIN', 'false') === 'true';
  }

  /**
   * Read the policy for `companyId`, materialising a default row on
   * first call. Results are cached for `POLICY_CACHE_TTL_MS` so the
   * guard's per-request read is essentially free.
   */
  async getForCompany(companyId: string): Promise<SecurityPolicy> {
    const cached = this.cache.get(companyId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.policy;
    }

    const existing = await this.prisma.securityPolicy.findUnique({
      where: { companyId },
    });
    if (existing) {
      this.cache.set(companyId, { policy: existing, expiresAt: now + POLICY_CACHE_TTL_MS });
      return existing;
    }

    // First read for this tenant — materialise the row using the
    // env default (so operators who wired the env before this
    // feature landed keep their intended posture on upgrade).
    const created = await this.prisma.securityPolicy.upsert({
      where: { companyId },
      create: {
        companyId,
        mfaEnforceHighPrivileged: this.envDefaultMfaEnforce,
      },
      update: {},
    });
    this.cache.set(companyId, { policy: created, expiresAt: now + POLICY_CACHE_TTL_MS });
    return created;
  }

  /**
   * Apply a partial update. All fields are optional (PATCH-style);
   * unset fields are left untouched. Emits `SECURITY_POLICY_UPDATED`
   * audit inside the same transaction.
   */
  async update(
    actor: { id: string; companyId: string; role: string },
    input: SecurityPolicyUpdate,
  ): Promise<SecurityPolicy> {
    if (Object.values(input).every((v) => v === undefined)) {
      // Fast path: caller sent an empty body → return current row without
      // touching the DB or emitting an audit. Consistent with PATCH
      // semantics of "apply no change".
      return this.getForCompany(actor.companyId);
    }

    // Location-sharing ENABLE requires an APPROVED DPIA whose parent
    // ROPA activity slug is `location-sharing` AND a fresh consent
    // copy SHA. Validate BEFORE the transaction so we don't roll back
    // for input errors — cheaper on the DB and cleaner error surface.
    let locationSharingPayload: Prisma.SecurityPolicyUpdateInput | null = null;
    if (input.locationSharing?.action === 'ENABLE') {
      locationSharingPayload = await this.validateLocationSharingEnable(actor, input.locationSharing);
    } else if (input.locationSharing?.action === 'DISABLE') {
      locationSharingPayload = {
        locationSharingEnabled: false,
        // Preserve `locationSharingEnabledAt / By / DpiaId /
        // ConsentCopySha` so the "was-ever-enabled" audit answer
        // survives (ADR-0041 §Rollout gate).
      };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Ensure the row exists so the update below never surprises with P2025.
      const before = await tx.securityPolicy.upsert({
        where: { companyId: actor.companyId },
        create: {
          companyId: actor.companyId,
          mfaEnforceHighPrivileged: this.envDefaultMfaEnforce,
        },
        update: {},
      });

      const patch: Prisma.SecurityPolicyUpdateInput = {
        updatedBy: { connect: { id: actor.id } },
      };
      if (input.mfaEnforceHighPrivileged !== undefined) {
        patch.mfaEnforceHighPrivileged = input.mfaEnforceHighPrivileged;
      }
      if (locationSharingPayload) {
        Object.assign(patch, locationSharingPayload);
      }

      const row = await tx.securityPolicy.update({
        where: { companyId: actor.companyId },
        data: patch,
      });

      const beforeJson: Record<string, unknown> = {
        mfaEnforceHighPrivileged: before.mfaEnforceHighPrivileged,
      };
      const afterJson: Record<string, unknown> = {
        mfaEnforceHighPrivileged: row.mfaEnforceHighPrivileged,
      };
      if (input.locationSharing) {
        beforeJson.locationSharingEnabled = before.locationSharingEnabled;
        afterJson.locationSharingEnabled = row.locationSharingEnabled;
        if (input.locationSharing.action === 'ENABLE') {
          afterJson.locationSharingDpiaId = row.locationSharingDpiaId;
          afterJson.locationSharingConsentCopySha = row.locationSharingConsentCopySha;
        }
      }

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action:
            input.locationSharing?.action === 'ENABLE'
              ? 'LOCATION_SHARING_ENABLED'
              : input.locationSharing?.action === 'DISABLE'
              ? 'LOCATION_SHARING_DISABLED'
              : 'SECURITY_POLICY_UPDATED',
          entityType: 'SecurityPolicy',
          entityId: row.id,
          beforeJson: beforeJson as Prisma.InputJsonValue,
          afterJson: afterJson as Prisma.InputJsonValue,
        },
      });

      return row;
    });

    // Invalidate cache immediately for the local replica so the next
    // request sees the new value without waiting for the TTL. Other
    // replicas converge within `POLICY_CACHE_TTL_MS`.
    this.cache.delete(actor.companyId);

    this.logger.log(
      `security policy updated companyId=${actor.companyId} actor=${actor.id} mfaEnforce=${updated.mfaEnforceHighPrivileged} locationSharing=${updated.locationSharingEnabled}`,
    );
    return updated;
  }

  /**
   * Server-side gate for the location-sharing enable flip. Rejects:
   *
   *   - Missing DPIA row (404).
   *   - DPIA belongs to another tenant (404 — do not leak).
   *   - DPIA is not APPROVED (400).
   *   - DPIA's parent RopaActivity slug is not `location-sharing`
   *     (400) — this ensures the DPIA that gates the flip was
   *     actually scoped to this feature, not a random other DPIA
   *     the tenant happens to have approved.
   *   - Consent copy SHA is not the current in-repo value (400).
   */
  private async validateLocationSharingEnable(
    actor: { id: string; companyId: string },
    input: Extract<SecurityPolicyLocationSharingAction, { action: 'ENABLE' }>,
  ): Promise<Prisma.SecurityPolicyUpdateInput> {
    if (input.consentCopySha !== LOCATION_SHARING_CONSENT_COPY.id) {
      throw new BadRequestException('CONSENT_COPY_STALE');
    }
    const dpia = await this.prisma.dpiaAssessment.findFirst({
      where: {
        id: input.dpiaId,
        companyId: actor.companyId,
      },
      include: { ropaActivity: { select: { slug: true } } },
    });
    if (!dpia) throw new NotFoundException('DPIA_NOT_FOUND');
    if (dpia.status !== 'APPROVED') throw new BadRequestException('DPIA_NOT_APPROVED');
    if (dpia.ropaActivity.slug !== 'location-sharing') {
      throw new BadRequestException('DPIA_ACTIVITY_MISMATCH');
    }
    return {
      locationSharingEnabled: true,
      locationSharingEnabledAt: new Date(),
      locationSharingEnabledBy: { connect: { id: actor.id } },
      locationSharingDpia: { connect: { id: dpia.id } },
      locationSharingConsentCopySha: input.consentCopySha,
    };
  }
}
