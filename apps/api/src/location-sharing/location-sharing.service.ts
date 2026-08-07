import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type LocationPing,
  type LocationShareRequest,
  LocationShareRequestStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { LOCATION_SHARING_CONSENT_COPY } from '@workpulse/shared-types';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  locationShareRequested,
  locationShareResponded,
  locationShareViewed,
  locationSharingConsentChanged,
} from '../notification/domain/templates';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityPolicyService } from '../security-policy/security-policy.service';
import {
  computeExpiresAt,
  LOCATION_PING_RETENTION_DAYS,
  LOCATION_SHARE_DAILY_QUOTA_PER_USER,
  LOCATION_SHARE_REQUEST_RETENTION_DAYS,
} from './domain/request-lifecycle';

type Tx = Prisma.TransactionClient | PrismaClient;

interface CreateRequestInput {
  targetUserId: string;
  reason: string;
}

interface AcceptInput {
  outcome: 'ACCEPT';
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  clientCapturedAt: Date;
}
interface DeclineInput {
  outcome: 'DECLINE';
}
export type RespondInput = AcceptInput | DeclineInput;

export type UpdateConsentInput =
  | { action: 'OPT_IN'; consentCopySha: string }
  | { action: 'OPT_OUT' };

export interface RequestRowView {
  request: LocationShareRequest & {
    supervisor: { fullName: string };
    targetUser: { fullName: string };
    locationPing: LocationPing | null;
  };
  /** True iff the current viewer is authorised to see `ping.*`. */
  canViewPing: boolean;
}

/**
 * Location Sharing service (ADR-0041).
 *
 * # Responsibilities
 *
 *   1. Gate every mutation by the tenant enable flag AND the target
 *      user's opt-in AND the caller's role.
 *   2. Enforce the 15-minute TTL, one-live-request-per-pair
 *      invariant, and the 6/user/24h quota.
 *   3. Persist audit metadata inside the same transaction as the
 *      state change — the immutable AuditLog is our regulator
 *      artifact.
 *   4. Fan out notifications AFTER the state change commits so a
 *      slow email host cannot roll back the business op.
 *
 * # NOT responsible for
 *
 *   - The `LOCATION_SHARE_VIEWED` push cadence on the receiver's
 *     phone — see notes in `NotificationService` for the delivery
 *     model. This service only *fires* the notification; the
 *     channel adapters decide reach.
 *   - Purging expired / stale rows — handled by
 *     `LocationSharingRetentionWorker`.
 */
@Injectable()
export class LocationSharingService {
  private readonly logger = new Logger(LocationSharingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly securityPolicy: SecurityPolicyService,
  ) {}

  // -------------------------------------------------------------------------
  // Supervisor path: create + view + cancel
  // -------------------------------------------------------------------------

  async createRequest(
    actor: AuthenticatedUser,
    input: CreateRequestInput,
    now: Date = new Date(),
  ): Promise<RequestRowView> {
    if (input.targetUserId === actor.id) {
      throw new BadRequestException('CANNOT_ASK_SELF');
    }

    // Only supervisors + HR + super admin may initiate — anyone else
    // hitting this endpoint gets a clean 403 rather than a subtle
    // constraint error later.
    if (actor.role !== 'SUPERVISOR' && actor.role !== 'HR_MANAGER' && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('NOT_A_REQUESTER_ROLE');
    }

    await this.assertTenantEnabled(actor.companyId);

    const target = await this.prisma.user.findFirst({
      where: {
        id: input.targetUserId,
        companyId: actor.companyId, // tenant scope
        deletedAt: null,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        isFieldWorker: true,
        locationSharingConsentedAt: true,
        locationSharingConsentCopySha: true,
        supervisorId: true,
      },
    });
    if (!target) {
      throw new NotFoundException('TARGET_USER_NOT_FOUND');
    }
    if (!target.isFieldWorker) {
      throw new ForbiddenException('TARGET_NOT_FIELD_WORKER');
    }
    if (!target.locationSharingConsentedAt) {
      throw new ForbiddenException('TARGET_NOT_OPTED_IN');
    }
    if (target.locationSharingConsentCopySha !== LOCATION_SHARING_CONSENT_COPY.id) {
      // Consent copy has been revised since the user last accepted —
      // do NOT act on the stale consent, force re-acceptance.
      throw new ForbiddenException('TARGET_CONSENT_STALE');
    }

    // A SUPERVISOR may only ask their own subordinates. HR + super
    // admin get to skip this because their operating scope is the
    // whole tenant already.
    if (actor.role === 'SUPERVISOR' && target.supervisorId !== actor.id) {
      throw new ForbiddenException('NOT_MY_SUBORDINATE');
    }

    // 24h rolling quota — count only PENDING and RESPONDED. See the
    // constant's doc for why.
    const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const activeInWindow = await this.prisma.locationShareRequest.count({
      where: {
        targetUserId: target.id,
        companyId: actor.companyId,
        createdAt: { gte: windowStart },
        status: { in: [LocationShareRequestStatus.PENDING, LocationShareRequestStatus.RESPONDED] },
      },
    });
    if (activeInWindow >= LOCATION_SHARE_DAILY_QUOTA_PER_USER) {
      throw new ConflictException('DAILY_QUOTA_EXCEEDED');
    }

    const expiresAt = computeExpiresAt(now);
    const created = await this.prisma.$transaction(async (tx) => {
      let row: LocationShareRequest;
      try {
        row = await tx.locationShareRequest.create({
          data: {
            companyId: actor.companyId,
            supervisorId: actor.id,
            targetUserId: target.id,
            reason: input.reason,
            expiresAt,
          },
        });
      } catch (err) {
        // The partial unique index (one PENDING per pair) fires as
        // P2002 when two supervisors race — surface a clean 409.
        if (isPrismaP2002(err)) {
          throw new ConflictException('PENDING_REQUEST_ALREADY_EXISTS');
        }
        throw err;
      }

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'LOCATION_SHARE_REQUESTED',
          entityType: 'LocationShareRequest',
          entityId: row.id,
          afterJson: {
            targetUserId: target.id,
            reason: input.reason,
            expiresAt: expiresAt.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });

      return row;
    });

    // Fanout AFTER the tx commits. Target user's three-channel
    // notification is fired here; NotificationService currently
    // delivers in-app + email — Web Push is a TODO (ADR-0041 open
    // scope, see PR description).
    await this.notifications
      .createOne({
        companyId: actor.companyId,
        recipientId: target.id,
        recipientEmail: target.email,
        content: locationShareRequested({
          requestId: created.id,
          supervisorName: actor.email, // fallback — enriched by caller
          reason: input.reason,
          expiresAt: expiresAt.toISOString(),
        }),
      })
      .catch((err: Error) =>
        this.logger.warn(`notif fanout failed requestId=${created.id}: ${err.message}`),
      );

    return this.loadRequestView(actor, created.id);
  }

  async cancelRequest(actor: AuthenticatedUser, requestId: string): Promise<RequestRowView> {
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadOwnPendingRequestForUpdate(tx, actor, requestId);
      const after = await tx.locationShareRequest.update({
        where: { id: row.id },
        data: {
          status: LocationShareRequestStatus.CANCELLED,
          cancelledAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'LOCATION_SHARE_CANCELLED',
          entityType: 'LocationShareRequest',
          entityId: row.id,
          beforeJson: { status: row.status } as Prisma.InputJsonValue,
          afterJson: { status: after.status } as Prisma.InputJsonValue,
        },
      });
      return after;
    });

    // Notify the target user so they know the ask was withdrawn.
    const target = await this.prisma.user.findUnique({
      where: { id: updated.targetUserId },
      select: { fullName: true, email: true },
    });
    if (target) {
      await this.notifications
        .createOne({
          companyId: actor.companyId,
          recipientId: updated.targetUserId,
          recipientEmail: target.email,
          content: locationShareResponded({
            requestId: updated.id,
            targetUserName: target.fullName,
            outcome: 'CANCELLED',
          }),
        })
        .catch((err: Error) =>
          this.logger.warn(`cancel notif failed requestId=${updated.id}: ${err.message}`),
        );
    }

    return this.loadRequestView(actor, updated.id);
  }

  /**
   * Called when the supervisor opens the request detail view. The
   * *first* view flips `viewedAt`; every view fires the "someone is
   * looking at your coord" transparency notification to the target.
   */
  async viewRequest(actor: AuthenticatedUser, requestId: string): Promise<RequestRowView> {
    const view = await this.loadRequestView(actor, requestId);
    const req = view.request;

    // Only supervisor + HR + super admin trigger the viewed
    // notification. If the TARGET user opens their own request,
    // no notification fires (they already know they shared it).
    const isViewerOfCoord =
      req.status === LocationShareRequestStatus.RESPONDED &&
      req.locationPing !== null &&
      view.canViewPing &&
      actor.id !== req.targetUserId;

    if (isViewerOfCoord) {
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.locationShareRequest.update({
          where: { id: req.id },
          data: { viewedAt: now },
        });
        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action: 'LOCATION_SHARE_VIEWED',
            entityType: 'LocationShareRequest',
            entityId: req.id,
            afterJson: {
              targetUserId: req.targetUserId,
              viewerRole: actor.role,
            } as Prisma.InputJsonValue,
          },
        });
      });

      await this.notifications
        .createOne({
          companyId: actor.companyId,
          recipientId: req.targetUserId,
          content: locationShareViewed({
            requestId: req.id,
            viewerName: actor.email, // enriched by caller
            viewerRole: labelForRole(actor.role),
          }),
        })
        .catch((err: Error) =>
          this.logger.warn(`viewed notif failed requestId=${req.id}: ${err.message}`),
        );

      return this.loadRequestView(actor, req.id);
    }

    return view;
  }

  // -------------------------------------------------------------------------
  // Target-user path: respond
  // -------------------------------------------------------------------------

  async respond(
    actor: AuthenticatedUser,
    requestId: string,
    input: RespondInput,
    now: Date = new Date(),
  ): Promise<RequestRowView> {
    const outcomeStatus =
      input.outcome === 'ACCEPT'
        ? LocationShareRequestStatus.RESPONDED
        : LocationShareRequestStatus.DECLINED;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.locationShareRequest.findFirst({
        where: {
          id: requestId,
          companyId: actor.companyId,
          targetUserId: actor.id, // only the target can respond
        },
        select: { id: true, status: true, expiresAt: true, supervisorId: true, reason: true },
      });
      if (!row) throw new NotFoundException('REQUEST_NOT_FOUND');
      if (row.status !== LocationShareRequestStatus.PENDING) {
        throw new ConflictException('REQUEST_NOT_PENDING');
      }
      if (row.expiresAt.getTime() <= now.getTime()) {
        // Race: the retention worker hasn't flipped it yet but TTL
        // has elapsed. Flip to EXPIRED right here so the user sees a
        // clean error and audit is consistent.
        await tx.locationShareRequest.update({
          where: { id: row.id },
          data: { status: LocationShareRequestStatus.EXPIRED },
        });
        throw new ConflictException('REQUEST_EXPIRED');
      }

      let pingId: string | null = null;
      if (input.outcome === 'ACCEPT') {
        // Consent recheck at response time — the user could have
        // toggled off since receiving the notification.
        const me = await tx.user.findUnique({
          where: { id: actor.id },
          select: {
            locationSharingConsentedAt: true,
            locationSharingConsentCopySha: true,
          },
        });
        if (!me?.locationSharingConsentedAt) {
          throw new ForbiddenException('NOT_OPTED_IN');
        }
        if (me.locationSharingConsentCopySha !== LOCATION_SHARING_CONSENT_COPY.id) {
          throw new ForbiddenException('CONSENT_COPY_STALE');
        }

        const ping = await tx.locationPing.create({
          data: {
            companyId: actor.companyId,
            userId: actor.id,
            latitude: input.latitude,
            longitude: input.longitude,
            accuracyMeters: input.accuracyMeters,
            clientCapturedAt: input.clientCapturedAt,
          },
        });
        pingId = ping.id;
      }

      const after = await tx.locationShareRequest.update({
        where: { id: row.id },
        data: {
          status: outcomeStatus,
          respondedAt: now,
          locationPingId: pingId,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action:
            input.outcome === 'ACCEPT' ? 'LOCATION_SHARE_ACCEPTED' : 'LOCATION_SHARE_DECLINED',
          entityType: 'LocationShareRequest',
          entityId: row.id,
          beforeJson: { status: row.status } as Prisma.InputJsonValue,
          afterJson: {
            status: after.status,
            hasPing: pingId !== null,
            // The coordinate itself is NOT written to the audit log —
            // ADR-0041 §Retention keeps ping data on a shorter clock
            // than audit log; storing the coord here would extend
            // its effective retention outside the DPIA envelope.
          } as Prisma.InputJsonValue,
        },
      });

      return { after, supervisorId: row.supervisorId };
    });

    // Notify supervisor of the outcome.
    const supervisor = await this.prisma.user.findUnique({
      where: { id: updated.supervisorId },
      select: { email: true, fullName: true },
    });
    const target = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { fullName: true },
    });
    if (supervisor && target) {
      await this.notifications
        .createOne({
          companyId: actor.companyId,
          recipientId: updated.after.supervisorId,
          recipientEmail: supervisor.email,
          content: locationShareResponded({
            requestId: updated.after.id,
            targetUserName: target.fullName,
            outcome:
              input.outcome === 'ACCEPT' ? 'RESPONDED' : 'DECLINED',
          }),
        })
        .catch((err: Error) =>
          this.logger.warn(`respond notif failed requestId=${updated.after.id}: ${err.message}`),
        );
    }

    return this.loadRequestView(actor, updated.after.id);
  }

  // -------------------------------------------------------------------------
  // User-side consent management
  // -------------------------------------------------------------------------

  async getSelfStatus(actor: AuthenticatedUser): Promise<{
    tenantEnabled: boolean;
    eligible: boolean;
    consentedAt: Date | null;
    consentedCopySha: string | null;
    currentCopySha: string;
  }> {
    const [policy, me] = await Promise.all([
      this.securityPolicy.getForCompany(actor.companyId),
      this.prisma.user.findUnique({
        where: { id: actor.id },
        select: {
          isFieldWorker: true,
          locationSharingConsentedAt: true,
          locationSharingConsentCopySha: true,
        },
      }),
    ]);
    return {
      tenantEnabled: policy.locationSharingEnabled,
      eligible: me?.isFieldWorker ?? false,
      consentedAt: me?.locationSharingConsentedAt ?? null,
      consentedCopySha: me?.locationSharingConsentCopySha ?? null,
      currentCopySha: LOCATION_SHARING_CONSENT_COPY.id,
    };
  }

  async updateConsent(
    actor: AuthenticatedUser,
    input: UpdateConsentInput,
    now: Date = new Date(),
  ): Promise<void> {
    if (input.action === 'OPT_IN') {
      if (input.consentCopySha !== LOCATION_SHARING_CONSENT_COPY.id) {
        throw new BadRequestException('CONSENT_COPY_STALE');
      }
      // Feature must be tenant-enabled AND user must be eligible.
      const policy = await this.securityPolicy.getForCompany(actor.companyId);
      if (!policy.locationSharingEnabled) {
        throw new ForbiddenException('FEATURE_NOT_ENABLED');
      }
      const me = await this.prisma.user.findUnique({
        where: { id: actor.id },
        select: { isFieldWorker: true },
      });
      if (!me?.isFieldWorker) {
        throw new ForbiddenException('NOT_FIELD_WORKER');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id: actor.id },
        select: {
          locationSharingConsentedAt: true,
          locationSharingConsentCopySha: true,
        },
      });
      await tx.user.update({
        where: { id: actor.id },
        data:
          input.action === 'OPT_IN'
            ? {
                locationSharingConsentedAt: now,
                locationSharingConsentCopySha: input.consentCopySha,
              }
            : {
                locationSharingConsentedAt: null,
                locationSharingConsentCopySha: null,
              },
      });

      // If opting out, cancel any PENDING requests aimed at this user
      // so their supervisor stops waiting on a doomed ask.
      if (input.action === 'OPT_OUT') {
        await tx.locationShareRequest.updateMany({
          where: {
            targetUserId: actor.id,
            status: LocationShareRequestStatus.PENDING,
          },
          data: {
            status: LocationShareRequestStatus.CANCELLED,
            cancelledAt: now,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action:
            input.action === 'OPT_IN'
              ? 'LOCATION_SHARING_OPTED_IN'
              : 'LOCATION_SHARING_OPTED_OUT',
          entityType: 'User',
          entityId: actor.id,
          beforeJson: {
            consentedAt: before?.locationSharingConsentedAt?.toISOString() ?? null,
            copySha: before?.locationSharingConsentCopySha ?? null,
          } as Prisma.InputJsonValue,
          afterJson: {
            consentedAt: input.action === 'OPT_IN' ? now.toISOString() : null,
            copySha: input.action === 'OPT_IN' ? input.consentCopySha : null,
          } as Prisma.InputJsonValue,
        },
      });
    });

    // Confirmation notification — visible in the bell dropdown as
    // the user's own record of the action.
    await this.notifications
      .createOne({
        companyId: actor.companyId,
        recipientId: actor.id,
        content: locationSharingConsentChanged({
          action: input.action,
          actorSelf: true,
        }),
      })
      .catch((err: Error) => this.logger.warn(`consent notif failed: ${err.message}`));
  }

  // -------------------------------------------------------------------------
  // Read helpers
  // -------------------------------------------------------------------------

  async listMyPending(actor: AuthenticatedUser): Promise<RequestRowView[]> {
    const rows = await this.prisma.locationShareRequest.findMany({
      where: {
        targetUserId: actor.id,
        companyId: actor.companyId,
        status: LocationShareRequestStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        supervisor: { select: { fullName: true } },
        targetUser: { select: { fullName: true } },
        locationPing: true,
      },
    });
    // Target user viewing their own inbox — they see the ping if they
    // sent one, but PENDING rows have no ping yet.
    return rows.map((r) => ({ request: r, canViewPing: false }));
  }

  async listMyOutgoing(actor: AuthenticatedUser, limit = 25): Promise<RequestRowView[]> {
    const rows = await this.prisma.locationShareRequest.findMany({
      where: {
        supervisorId: actor.id,
        companyId: actor.companyId,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        supervisor: { select: { fullName: true } },
        targetUser: { select: { fullName: true } },
        locationPing: true,
      },
    });
    return rows.map((r) => ({ request: r, canViewPing: true }));
  }

  private async loadRequestView(
    actor: AuthenticatedUser,
    requestId: string,
  ): Promise<RequestRowView> {
    const row = await this.prisma.locationShareRequest.findFirst({
      where: {
        id: requestId,
        companyId: actor.companyId,
      },
      include: {
        supervisor: { select: { fullName: true } },
        targetUser: { select: { fullName: true } },
        locationPing: true,
      },
    });
    if (!row) throw new NotFoundException('REQUEST_NOT_FOUND');

    const isSupervisorOnThis = row.supervisorId === actor.id;
    const isTargetOnThis = row.targetUserId === actor.id;
    const isAdminScope = actor.role === 'HR_MANAGER' || actor.role === 'SUPER_ADMIN';
    if (!isSupervisorOnThis && !isTargetOnThis && !isAdminScope) {
      throw new ForbiddenException('NOT_A_PARTY_TO_REQUEST');
    }

    // Target user viewing their OWN request sees the ping (they
    // reported it), but this doesn't trigger the "viewed" notification
    // (they're the source). Admin scope + supervisor sees the ping
    // and DOES trigger the "viewed" notification when they call
    // `viewRequest`.
    const canViewPing = isTargetOnThis || isSupervisorOnThis || isAdminScope;

    return { request: row, canViewPing };
  }

  private async loadOwnPendingRequestForUpdate(
    tx: Tx,
    actor: AuthenticatedUser,
    requestId: string,
  ): Promise<LocationShareRequest> {
    const row = await tx.locationShareRequest.findFirst({
      where: {
        id: requestId,
        companyId: actor.companyId,
        supervisorId: actor.id, // only the initiator can cancel
        status: LocationShareRequestStatus.PENDING,
      },
    });
    if (!row) throw new NotFoundException('REQUEST_NOT_FOUND_OR_NOT_PENDING');
    return row;
  }

  private async assertTenantEnabled(companyId: string): Promise<void> {
    const policy = await this.securityPolicy.getForCompany(companyId);
    if (!policy.locationSharingEnabled) {
      throw new ForbiddenException('FEATURE_NOT_ENABLED');
    }
  }
}

// ---------------------------------------------------------------------------
// Retention worker helpers (exported for the worker to reuse)
// ---------------------------------------------------------------------------

export interface PurgeSummary {
  pingsPurged: number;
  requestsPurged: number;
  requestsExpired: number;
}

/**
 * Standalone purge routine so `LocationSharingRetentionWorker`
 * can invoke it per-tenant without coupling to the class. Kept
 * exported for direct testing and ops-triggered `runOnce`.
 */
export async function purgeLocationSharingForCompany(
  tx: Tx,
  companyId: string,
  now: Date,
): Promise<PurgeSummary> {
  // 1. Flip PENDING rows whose TTL elapsed → EXPIRED. Must run
  //    BEFORE the retention delete so the request row is in its
  //    proper terminal state when it eventually gets purged 90d
  //    later. Also so the supervisor's dashboard doesn't show a
  //    zombie PENDING that will never move.
  const expired = await tx.locationShareRequest.updateMany({
    where: {
      companyId,
      status: LocationShareRequestStatus.PENDING,
      expiresAt: { lte: now },
    },
    data: { status: LocationShareRequestStatus.EXPIRED },
  });

  // 2. Delete pings older than 7 days.
  const pingCutoff = new Date(now.getTime() - LOCATION_PING_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const pings = await tx.locationPing.deleteMany({
    where: {
      companyId,
      createdAt: { lt: pingCutoff },
    },
  });

  // 3. Delete request rows older than 90 days. Their ping is
  //    already gone (pings live 7d, requests 90d), so
  //    `locationPingId` on any surviving row that references a
  //    deleted ping is already `null` via `ON DELETE SET NULL`.
  const requestCutoff = new Date(
    now.getTime() - LOCATION_SHARE_REQUEST_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const requests = await tx.locationShareRequest.deleteMany({
    where: {
      companyId,
      createdAt: { lt: requestCutoff },
    },
  });

  return {
    pingsPurged: pings.count,
    requestsPurged: requests.count,
    requestsExpired: expired.count,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function labelForRole(role: string): string {
  switch (role) {
    case 'SUPERVISOR':
      return 'supervisor';
    case 'HR_MANAGER':
      return 'HR';
    case 'SUPER_ADMIN':
      return 'admin sistem';
    default:
      return role.toLowerCase();
  }
}

function isPrismaP2002(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}
