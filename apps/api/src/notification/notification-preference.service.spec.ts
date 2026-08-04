import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { NotificationPreferenceService } from './notification-preference.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';


function setup(): {
  service: NotificationPreferenceService;
  prisma: DeepMockProxy<PrismaService>;
} {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  // Default: no stored preferences → all defaults-on.
  prisma.notificationPreference.findMany.mockResolvedValue([] as never);
  prisma.notificationPreference.findUnique.mockResolvedValue(null as never);
  prisma.notificationPreference.upsert.mockResolvedValue({} as never);
  (prisma.$transaction as unknown as jest.Mock).mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: PrismaService) => unknown)(prisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
  const service = new NotificationPreferenceService(prisma);
  return { service, prisma };
}

const actor: AuthenticatedUser = {
  id: 'u-1',
  companyId: 'c-1',
  departmentId: null,
  email: 'u1@example.com',
  role: 'EMPLOYEE',
};

describe('NotificationPreferenceService.listForActor', () => {
  it('returns one row per known type with defaults-on when no preferences stored', async () => {
    const s = setup();
    const rows = await s.service.listForActor(actor);
    expect(rows.length).toBe(23);
    for (const r of rows) {
      expect(r.emailEnabled).toBe(true);
      expect(r.inAppEnabled).toBe(true);
    }
    const passwordReset = rows.find((r) => r.type === 'PASSWORD_RESET');
    expect(passwordReset?.mandatory).toBe(true);
    const leaveApprovedHr = rows.find((r) => r.type === 'LEAVE_APPROVED_HR');
    expect(leaveApprovedHr?.mandatory).toBe(false);
  });

  it('hydrates stored preferences and merges with defaults for other types', async () => {
    const s = setup();
    s.prisma.notificationPreference.findMany.mockResolvedValue([
      { type: 'LEAVE_REJECTED', emailEnabled: false, inAppEnabled: true },
      { type: 'OVERTIME_SUBMITTED', emailEnabled: false, inAppEnabled: false },
    ] as never);
    const rows = await s.service.listForActor(actor);
    expect(rows.find((r) => r.type === 'LEAVE_REJECTED')).toEqual({
      type: 'LEAVE_REJECTED',
      emailEnabled: false,
      inAppEnabled: true,
      mandatory: false,
    });
    expect(rows.find((r) => r.type === 'OVERTIME_SUBMITTED')).toEqual({
      type: 'OVERTIME_SUBMITTED',
      emailEnabled: false,
      inAppEnabled: false,
      mandatory: false,
    });
    // Untouched types stay defaults-on.
    expect(rows.find((r) => r.type === 'LEAVE_APPROVED_HR')?.emailEnabled).toBe(true);
  });

  it('forces mandatory types to enabled=true even when a stored row says false', async () => {
    const s = setup();
    // Some cursed row got into the DB (e.g. via a migration bug). The
    // service must still surface it as "both on" to protect security.
    s.prisma.notificationPreference.findMany.mockResolvedValue([
      { type: 'PASSWORD_RESET', emailEnabled: false, inAppEnabled: false },
    ] as never);
    const rows = await s.service.listForActor(actor);
    const pw = rows.find((r) => r.type === 'PASSWORD_RESET');
    expect(pw).toEqual({
      type: 'PASSWORD_RESET',
      emailEnabled: true,
      inAppEnabled: true,
      mandatory: true,
    });
  });
});

describe('NotificationPreferenceService.upsertMany', () => {
  it('upserts one row per opt-outable update', async () => {
    const s = setup();
    await s.service.upsertMany(actor, [
      { type: 'LEAVE_APPROVED_HR', emailEnabled: false, inAppEnabled: true },
      { type: 'OVERTIME_APPROVED', emailEnabled: true, inAppEnabled: false },
    ]);
    expect(s.prisma.notificationPreference.upsert).toHaveBeenCalledTimes(2);
    const first = s.prisma.notificationPreference.upsert.mock.calls[0]?.[0];
    expect(first?.where.userId_type).toEqual({
      userId: 'u-1',
      type: 'LEAVE_APPROVED_HR',
    });
    expect(first?.create).toMatchObject({
      companyId: 'c-1',
      userId: 'u-1',
      type: 'LEAVE_APPROVED_HR',
      emailEnabled: false,
      inAppEnabled: true,
    });
  });

  it('silently drops mandatory types from the payload', async () => {
    const s = setup();
    await s.service.upsertMany(actor, [
      { type: 'PASSWORD_RESET', emailEnabled: false, inAppEnabled: false },
      { type: 'LEAVE_CANCELLED', emailEnabled: false, inAppEnabled: false },
    ]);
    expect(s.prisma.notificationPreference.upsert).toHaveBeenCalledTimes(1);
    const only = s.prisma.notificationPreference.upsert.mock.calls[0]?.[0];
    expect(only?.where.userId_type?.type).toBe('LEAVE_CANCELLED');
  });

  it('is a no-op when the payload is empty (still returns fresh list)', async () => {
    const s = setup();
    const rows = await s.service.upsertMany(actor, []);
    expect(s.prisma.notificationPreference.upsert).not.toHaveBeenCalled();
    expect(rows.length).toBe(23);
  });

  it('dedupes on type — last-write-wins', async () => {
    const s = setup();
    await s.service.upsertMany(actor, [
      { type: 'OVERTIME_APPROVED', emailEnabled: true, inAppEnabled: true },
      { type: 'OVERTIME_APPROVED', emailEnabled: false, inAppEnabled: false },
    ]);
    expect(s.prisma.notificationPreference.upsert).toHaveBeenCalledTimes(1);
    const call = s.prisma.notificationPreference.upsert.mock.calls[0]?.[0];
    expect(call?.create).toMatchObject({
      emailEnabled: false,
      inAppEnabled: false,
    });
  });
});

describe('NotificationPreferenceService.getEffective', () => {
  it('returns defaults-on when no row exists', async () => {
    const s = setup();
    const eff = await s.service.getEffective('u-1', 'LEAVE_APPROVED_HR');
    expect(eff).toEqual({ emailEnabled: true, inAppEnabled: true });
  });

  it('returns row values for opt-outable types', async () => {
    const s = setup();
    s.prisma.notificationPreference.findUnique.mockResolvedValue({
      type: 'LEAVE_APPROVED_HR',
      emailEnabled: false,
      inAppEnabled: true,
    } as never);
    const eff = await s.service.getEffective('u-1', 'LEAVE_APPROVED_HR');
    expect(eff).toEqual({ emailEnabled: false, inAppEnabled: true });
  });

  it('bypasses opt-out for mandatory types', async () => {
    const s = setup();
    s.prisma.notificationPreference.findUnique.mockResolvedValue({
      type: 'PASSWORD_RESET',
      emailEnabled: false,
      inAppEnabled: false,
    } as never);
    const eff = await s.service.getEffective('u-1', 'PASSWORD_RESET');
    expect(eff).toEqual({ emailEnabled: true, inAppEnabled: true });
  });
});
