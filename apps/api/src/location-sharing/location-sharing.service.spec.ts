import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { SecurityPolicy, User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { LOCATION_SHARING_CONSENT_COPY } from '@workpulse/shared-types';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityPolicyService } from '../security-policy/security-policy.service';
import { LocationSharingService } from './location-sharing.service';

interface Kit {
  service: LocationSharingService;
  prisma: DeepMockProxy<PrismaService>;
  notifications: DeepMockProxy<NotificationService>;
  policy: DeepMockProxy<SecurityPolicyService>;
}

function buildKit(): Kit {
  const prisma = mockDeep<PrismaService>();
  const notifications = mockDeep<NotificationService>();
  const policy = mockDeep<SecurityPolicyService>();
  mockReset(prisma);
  mockReset(notifications);
  mockReset(policy);

  // Default: tenant has feature enabled, and any $transaction call
  // just executes the callback with the prisma mock as the tx handle.
  policy.getForCompany.mockResolvedValue(makePolicy({ locationSharingEnabled: true }));
  (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => cb(prisma));
  notifications.createOne.mockResolvedValue(undefined);

  const service = new LocationSharingService(prisma, notifications, policy);
  return { service, prisma, notifications, policy };
}

function actor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'u-supervisor',
    email: 'sup@example.com',
    companyId: 'c-1',
    departmentId: null,
    role: 'SUPERVISOR',
    ...overrides,
  };
}

function makePolicy(overrides: Partial<SecurityPolicy> = {}): SecurityPolicy {
  return {
    id: 'sp-1',
    companyId: 'c-1',
    mfaEnforceHighPrivileged: false,
    locationSharingEnabled: true,
    locationSharingEnabledAt: new Date('2026-08-06T00:00:00Z'),
    locationSharingEnabledById: 'u-superadmin',
    locationSharingDpiaId: 'dpia-1',
    locationSharingConsentCopySha: LOCATION_SHARING_CONSENT_COPY.id,
    updatedAt: new Date('2026-08-06T00:00:00Z'),
    updatedById: null,
    createdAt: new Date('2026-08-06T00:00:00Z'),
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> & { id: string; companyId: string }): User {
  const base: User = {
    id: overrides.id,
    companyId: overrides.companyId,
    departmentId: null,
    email: `${overrides.id}@example.com`,
    passwordHash: 'x',
    mustChangePassword: false,
    mfaSecret: null,
    mfaEnabledAt: null,
    fullName: overrides.id,
    role: 'EMPLOYEE',
    employmentStatus: 'ACTIVE',
    hiredAt: new Date('2025-01-01T00:00:00Z'),
    supervisorId: null,
    timezone: null,
    overtimeHourlyRate: null,
    isFieldWorker: true,
    locationSharingConsentedAt: new Date('2026-08-07T00:00:00Z'),
    locationSharingConsentCopySha: LOCATION_SHARING_CONSENT_COPY.id,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
  } as User;
  return { ...base, ...overrides };
}

describe('LocationSharingService.createRequest', () => {
  const now = new Date('2026-08-07T10:00:00Z');

  it('rejects when supervisor targets themselves', async () => {
    const { service } = buildKit();
    await expect(
      service.createRequest(actor({ id: 'u-1' }), { targetUserId: 'u-1', reason: 'test' }, now),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects EMPLOYEE role (only supervisor+HR+super admin may ask)', async () => {
    const { service } = buildKit();
    await expect(
      service.createRequest(
        actor({ role: 'EMPLOYEE' }),
        { targetUserId: 'u-2', reason: 'test-reason' },
        now,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when tenant has feature disabled', async () => {
    const { service, policy } = buildKit();
    policy.getForCompany.mockResolvedValue(
      makePolicy({ locationSharingEnabled: false }),
    );
    await expect(
      service.createRequest(actor(), { targetUserId: 'u-2', reason: 'test-reason' }, now),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when target is not isFieldWorker', async () => {
    const { service, prisma } = buildKit();
    prisma.user.findFirst.mockResolvedValue(
      makeUser({ id: 'u-2', companyId: 'c-1', isFieldWorker: false }),
    );
    await expect(
      service.createRequest(actor(), { targetUserId: 'u-2', reason: 'test-reason' }, now),
    ).rejects.toMatchObject({ message: 'TARGET_NOT_FIELD_WORKER' });
  });

  it('rejects when target has not opted in', async () => {
    const { service, prisma } = buildKit();
    prisma.user.findFirst.mockResolvedValue(
      makeUser({
        id: 'u-2',
        companyId: 'c-1',
        locationSharingConsentedAt: null,
        locationSharingConsentCopySha: null,
      }),
    );
    await expect(
      service.createRequest(actor(), { targetUserId: 'u-2', reason: 'test-reason' }, now),
    ).rejects.toMatchObject({ message: 'TARGET_NOT_OPTED_IN' });
  });

  it('rejects when target consent copy SHA drift is detected', async () => {
    const { service, prisma } = buildKit();
    prisma.user.findFirst.mockResolvedValue(
      makeUser({
        id: 'u-2',
        companyId: 'c-1',
        locationSharingConsentCopySha: 'stale-sha',
      }),
    );
    await expect(
      service.createRequest(actor(), { targetUserId: 'u-2', reason: 'test-reason' }, now),
    ).rejects.toMatchObject({ message: 'TARGET_CONSENT_STALE' });
  });

  it('rejects when supervisor asks a user who is not their subordinate', async () => {
    const { service, prisma } = buildKit();
    prisma.user.findFirst.mockResolvedValue(
      makeUser({
        id: 'u-2',
        companyId: 'c-1',
        supervisorId: 'someone-else',
      }),
    );
    await expect(
      service.createRequest(actor(), { targetUserId: 'u-2', reason: 'test-reason' }, now),
    ).rejects.toMatchObject({ message: 'NOT_MY_SUBORDINATE' });
  });

  it('HR bypasses the subordinate check', async () => {
    const { service, prisma } = buildKit();
    prisma.user.findFirst.mockResolvedValue(
      makeUser({
        id: 'u-2',
        companyId: 'c-1',
        supervisorId: 'someone-else',
      }),
    );
    prisma.locationShareRequest.count.mockResolvedValue(0);
    prisma.locationShareRequest.create.mockResolvedValue({
      id: 'r-1',
      companyId: 'c-1',
      supervisorId: 'u-hr',
      targetUserId: 'u-2',
      status: 'PENDING',
      reason: 'check-in',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      respondedAt: null,
      cancelledAt: null,
      viewedAt: null,
      locationPingId: null,
    });
    prisma.locationShareRequest.findFirst.mockResolvedValue({
      id: 'r-1',
      companyId: 'c-1',
      supervisorId: 'u-hr',
      targetUserId: 'u-2',
      status: 'PENDING',
      reason: 'check-in',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      respondedAt: null,
      cancelledAt: null,
      viewedAt: null,
      locationPingId: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // The final view lookup returns the same row shape with relations.
    prisma.locationShareRequest.findFirst.mockResolvedValue({
      id: 'r-1',
      companyId: 'c-1',
      supervisorId: 'u-hr',
      targetUserId: 'u-2',
      status: 'PENDING',
      reason: 'check-in',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      respondedAt: null,
      cancelledAt: null,
      viewedAt: null,
      locationPingId: null,
      supervisor: { fullName: 'HR User' },
      targetUser: { fullName: 'Field Worker' },
      locationPing: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await expect(
      service.createRequest(
        actor({ id: 'u-hr', role: 'HR_MANAGER' }),
        { targetUserId: 'u-2', reason: 'check-in' },
        now,
      ),
    ).resolves.toMatchObject({ request: { id: 'r-1', status: 'PENDING' } });
  });

  it('rejects when the daily quota is exhausted', async () => {
    const { service, prisma } = buildKit();
    prisma.user.findFirst.mockResolvedValue(
      makeUser({ id: 'u-2', companyId: 'c-1', supervisorId: 'u-supervisor' }),
    );
    prisma.locationShareRequest.count.mockResolvedValue(6);
    await expect(
      service.createRequest(actor(), { targetUserId: 'u-2', reason: 'test-reason' }, now),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps P2002 (concurrent create) to a 409 CONFLICT with a stable error code', async () => {
    const { service, prisma } = buildKit();
    prisma.user.findFirst.mockResolvedValue(
      makeUser({ id: 'u-2', companyId: 'c-1', supervisorId: 'u-supervisor' }),
    );
    prisma.locationShareRequest.count.mockResolvedValue(0);
    prisma.locationShareRequest.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique violation', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      service.createRequest(actor(), { targetUserId: 'u-2', reason: 'test-reason' }, now),
    ).rejects.toMatchObject({ message: 'PENDING_REQUEST_ALREADY_EXISTS' });
  });
});

describe('LocationSharingService.respond', () => {
  const now = new Date('2026-08-07T10:05:00Z');

  it('rejects when the request does not belong to the caller', async () => {
    const { service, prisma } = buildKit();
    prisma.locationShareRequest.findFirst.mockResolvedValue(null);
    await expect(
      service.respond(actor({ id: 'u-2', role: 'EMPLOYEE' }), 'r-1', { outcome: 'DECLINE' }, now),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects DECLINE on an already-responded request', async () => {
    const { service, prisma } = buildKit();
    prisma.locationShareRequest.findFirst.mockResolvedValue({
      id: 'r-1',
      status: 'RESPONDED',
      expiresAt: new Date(now.getTime() + 60_000),
      supervisorId: 'u-supervisor',
      reason: 'x',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await expect(
      service.respond(actor({ id: 'u-2', role: 'EMPLOYEE' }), 'r-1', { outcome: 'DECLINE' }, now),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('flips to EXPIRED and rejects when TTL elapsed', async () => {
    const { service, prisma } = buildKit();
    prisma.locationShareRequest.findFirst.mockResolvedValue({
      id: 'r-1',
      status: 'PENDING',
      expiresAt: new Date(now.getTime() - 1),
      supervisorId: 'u-supervisor',
      reason: 'x',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await expect(
      service.respond(actor({ id: 'u-2', role: 'EMPLOYEE' }), 'r-1', { outcome: 'DECLINE' }, now),
    ).rejects.toMatchObject({ message: 'REQUEST_EXPIRED' });
    expect(prisma.locationShareRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'EXPIRED' } }),
    );
  });

  it('ACCEPT requires the caller to still be opted-in with a current copy SHA', async () => {
    const { service, prisma } = buildKit();
    prisma.locationShareRequest.findFirst.mockResolvedValue({
      id: 'r-1',
      status: 'PENDING',
      expiresAt: new Date(now.getTime() + 60_000),
      supervisorId: 'u-supervisor',
      reason: 'x',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    prisma.user.findUnique.mockResolvedValue({
      locationSharingConsentedAt: null,
      locationSharingConsentCopySha: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await expect(
      service.respond(
        actor({ id: 'u-2', role: 'EMPLOYEE' }),
        'r-1',
        {
          outcome: 'ACCEPT',
          latitude: -6.2,
          longitude: 106.8,
          accuracyMeters: 20,
          clientCapturedAt: now,
        },
        now,
      ),
    ).rejects.toMatchObject({ message: 'NOT_OPTED_IN' });
  });
});

describe('LocationSharingService.updateConsent', () => {
  it('OPT_IN rejects a stale consent copy SHA', async () => {
    const { service } = buildKit();
    await expect(
      service.updateConsent(actor({ id: 'u-1', role: 'EMPLOYEE' }), {
        action: 'OPT_IN',
        consentCopySha: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ message: 'CONSENT_COPY_STALE' });
  });

  it('OPT_IN rejects when tenant has feature disabled', async () => {
    const { service, policy } = buildKit();
    policy.getForCompany.mockResolvedValue(
      makePolicy({ locationSharingEnabled: false }),
    );
    await expect(
      service.updateConsent(actor({ id: 'u-1', role: 'EMPLOYEE' }), {
        action: 'OPT_IN',
        consentCopySha: LOCATION_SHARING_CONSENT_COPY.id,
      }),
    ).rejects.toMatchObject({ message: 'FEATURE_NOT_ENABLED' });
  });

  it('OPT_IN rejects a non-field-worker user', async () => {
    const { service, prisma } = buildKit();
    prisma.user.findUnique.mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { isFieldWorker: false } as any,
    );
    await expect(
      service.updateConsent(actor({ id: 'u-1', role: 'EMPLOYEE' }), {
        action: 'OPT_IN',
        consentCopySha: LOCATION_SHARING_CONSENT_COPY.id,
      }),
    ).rejects.toMatchObject({ message: 'NOT_FIELD_WORKER' });
  });

  it('OPT_OUT cancels any PENDING requests aimed at the user', async () => {
    const { service, prisma } = buildKit();
    prisma.user.findUnique.mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { locationSharingConsentedAt: new Date(), locationSharingConsentCopySha: 'x' } as any,
    );
    prisma.locationShareRequest.updateMany.mockResolvedValue({ count: 2 });

    await service.updateConsent(actor({ id: 'u-1', role: 'EMPLOYEE' }), { action: 'OPT_OUT' });

    expect(prisma.locationShareRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ targetUserId: 'u-1', status: 'PENDING' }),
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
  });
});
