import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, SecurityPolicy } from '@prisma/client';

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
export interface SecurityPolicyUpdate {
  mfaEnforceHighPrivileged?: boolean;
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
    this.envDefaultMfaEnforce =
      config.get<string>('MFA_ENFORCE_HR_ADMIN', 'false') === 'true';
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

      const row = await tx.securityPolicy.update({
        where: { companyId: actor.companyId },
        data: {
          ...input,
          updatedById: actor.id,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'SECURITY_POLICY_UPDATED',
          entityType: 'SecurityPolicy',
          entityId: row.id,
          beforeJson: {
            mfaEnforceHighPrivileged: before.mfaEnforceHighPrivileged,
          } as Prisma.InputJsonValue,
          afterJson: {
            mfaEnforceHighPrivileged: row.mfaEnforceHighPrivileged,
          } as Prisma.InputJsonValue,
        },
      });

      return row;
    });

    // Invalidate cache immediately for the local replica so the next
    // request sees the new value without waiting for the TTL. Other
    // replicas converge within `POLICY_CACHE_TTL_MS`.
    this.cache.delete(actor.companyId);

    this.logger.log(
      `security policy updated companyId=${actor.companyId} actor=${actor.id} mfaEnforceHighPrivileged=${updated.mfaEnforceHighPrivileged}`,
    );
    return updated;
  }
}
