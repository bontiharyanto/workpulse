import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import { NotificationService } from './notification.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { EMAIL_ADAPTER, type EmailAdapter } from './email/email-adapter';

const actor: AuthenticatedUser = {
  id: 'u-1',
  email: 'u1@acme.test',
  companyId: 'co-1',
  departmentId: null,
  role: 'EMPLOYEE',
};

interface FakeEmail extends EmailAdapter {
  sent: Array<{ to: string; subject: string; body: string }>;
}

function makeEmail(): FakeEmail {
  const sent: FakeEmail['sent'] = [];
  return {
    transport: 'fake',
    sent,
    async send(m) {
      sent.push(m);
    },
  };
}

function setup(
  overrides: {
    effective?: { emailEnabled: boolean; inAppEnabled: boolean };
  } = {},
): {
  service: NotificationService;
  prisma: DeepMockProxy<PrismaService>;
  email: FakeEmail;
  prefs: DeepMockProxy<NotificationPreferenceService>;
} {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  const email = makeEmail();
  const prefs = mockDeep<NotificationPreferenceService>();
  // Default: both channels on (defaults-on), which matches the
  // untouched-preferences baseline for every existing test.
  prefs.getEffective.mockResolvedValue(
    overrides.effective ?? { emailEnabled: true, inAppEnabled: true },
  );
  const service = new NotificationService(prisma, email, prefs);
  return { service, prisma, email, prefs };
}

describe('NotificationService.createOne', () => {
  it('persists the row and dispatches an email when a recipient address is supplied', async () => {
    const { service, prisma, email } = setup();
    prisma.notification.create.mockResolvedValueOnce({} as never);

    await service.createOne({
      companyId: 'co-1',
      recipientId: 'u-2',
      recipientEmail: 'u2@acme.test',
      content: {
        type: 'LEAVE_SUBMITTED',
        title: 'Cuti baru',
        body: 'Ada pengajuan baru.',
        data: { leaveRequestId: 'lr-1' },
      },
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'co-1',
        recipientId: 'u-2',
        type: 'LEAVE_SUBMITTED',
        title: 'Cuti baru',
        body: 'Ada pengajuan baru.',
      }),
    });
    // Email dispatch is async fire-and-forget — flush the microtask queue
    // by awaiting a resolved promise before assertions.
    await Promise.resolve();
    expect(email.sent).toEqual([
      { to: 'u2@acme.test', subject: 'Cuti baru', body: 'Ada pengajuan baru.' },
    ]);
  });

  it('skips email when no recipient address is supplied (in-app only)', async () => {
    const { service, prisma, email } = setup();
    prisma.notification.create.mockResolvedValueOnce({} as never);

    await service.createOne({
      companyId: 'co-1',
      recipientId: 'u-2',
      content: {
        type: 'OVERTIME_COMPLETED',
        title: 'x',
        body: 'y',
        data: {},
      },
    });

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(email.sent).toEqual([]);
  });

  // ---- Preference gate (Fase 22) ------------------------------------

  it('suppresses in-app when preference says inAppEnabled=false but still sends email', async () => {
    const { service, prisma, email } = setup({
      effective: { emailEnabled: true, inAppEnabled: false },
    });
    prisma.notification.create.mockResolvedValueOnce({} as never);

    await service.createOne({
      companyId: 'co-1',
      recipientId: 'u-2',
      recipientEmail: 'u2@acme.test',
      content: { type: 'LEAVE_APPROVED_HR', title: 't', body: 'b', data: {} },
    });

    expect(prisma.notification.create).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(email.sent).toHaveLength(1);
  });

  it('suppresses email when preference says emailEnabled=false but still writes in-app row', async () => {
    const { service, prisma, email } = setup({
      effective: { emailEnabled: false, inAppEnabled: true },
    });
    prisma.notification.create.mockResolvedValueOnce({} as never);

    await service.createOne({
      companyId: 'co-1',
      recipientId: 'u-2',
      recipientEmail: 'u2@acme.test',
      content: { type: 'OVERTIME_APPROVED', title: 't', body: 'b', data: {} },
    });

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(email.sent).toEqual([]);
  });

  it('is a no-op when both channels are opted out', async () => {
    const { service, prisma, email } = setup({
      effective: { emailEnabled: false, inAppEnabled: false },
    });

    await service.createOne({
      companyId: 'co-1',
      recipientId: 'u-2',
      recipientEmail: 'u2@acme.test',
      content: { type: 'LEAVE_REJECTED', title: 't', body: 'b', data: {} },
    });

    expect(prisma.notification.create).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(email.sent).toEqual([]);
  });

  it('consults the recipient (not the sender) when resolving preferences', async () => {
    const { service, prefs } = setup();
    prefs.getEffective.mockResolvedValue({
      emailEnabled: true,
      inAppEnabled: true,
    });

    await service.createOne({
      companyId: 'co-1',
      recipientId: 'u-recipient',
      content: { type: 'LEAVE_APPROVED_HR', title: 't', body: 'b', data: {} },
    });

    const call = prefs.getEffective.mock.calls[0];
    expect(call?.[0]).toBe('u-recipient');
    expect(call?.[1]).toBe('LEAVE_APPROVED_HR');
  });
});

describe('NotificationService.list / unreadCount', () => {
  it('lists newest-first and can filter unread only', async () => {
    const { service, prisma } = setup();
    prisma.notification.findMany.mockResolvedValueOnce([
      {
        id: 'n1',
        type: 'LEAVE_SUBMITTED',
        title: 't',
        body: 'b',
        data: { leaveRequestId: 'lr-1' },
        readAt: null,
        createdAt: new Date('2026-08-01T10:00:00Z'),
      },
    ] as never);

    const list = await service.list(actor, { unreadOnly: true, limit: 5 });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { recipientId: 'u-1', readAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    );
    expect(list[0]?.readAt).toBeNull();
    expect(list[0]?.data).toEqual({ leaveRequestId: 'lr-1' });
  });

  it('clamps limit to safe bounds', async () => {
    const { service, prisma } = setup();
    prisma.notification.findMany.mockResolvedValue([] as never);

    await service.list(actor, { limit: 9_999 });
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );

    await service.list(actor, { limit: 0 });
    expect(prisma.notification.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 1 }),
    );
  });

  it('unreadCount is scoped to caller + null readAt', async () => {
    const { service, prisma } = setup();
    prisma.notification.count.mockResolvedValueOnce(3);
    await expect(service.unreadCount(actor)).resolves.toBe(3);
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { recipientId: 'u-1', readAt: null },
    });
  });
});

describe('NotificationService.markRead', () => {
  it('marks a single unread row', async () => {
    const { service, prisma } = setup();
    prisma.notification.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(service.markRead(actor, 'n1')).resolves.toBeUndefined();
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'n1', recipientId: 'u-1', readAt: null },
      }),
    );
  });

  it('is idempotent for an already-read row (does not 404)', async () => {
    const { service, prisma } = setup();
    prisma.notification.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.notification.findFirst.mockResolvedValueOnce({ id: 'n1' } as never);
    await expect(service.markRead(actor, 'n1')).resolves.toBeUndefined();
  });

  it('returns 404 when the row does not belong to the caller', async () => {
    const { service, prisma } = setup();
    prisma.notification.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.notification.findFirst.mockResolvedValueOnce(null);
    await expect(service.markRead(actor, 'n1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('NotificationService.markAllRead', () => {
  it('reports how many rows were marked', async () => {
    const { service, prisma } = setup();
    prisma.notification.updateMany.mockResolvedValueOnce({ count: 7 });
    await expect(service.markAllRead(actor)).resolves.toEqual({ marked: 7 });
  });
});

// ---------------------------------------------------------------------------
// listPaginated — Fase 25 archive endpoint
// ---------------------------------------------------------------------------

function row(overrides: {
  id: string;
  createdAt: Date;
  readAt?: Date | null;
  type?: string;
}): unknown {
  return {
    id: overrides.id,
    type: overrides.type ?? 'LEAVE_APPROVED_HR',
    title: 'hello',
    body: 'world',
    data: null,
    readAt: overrides.readAt ?? null,
    createdAt: overrides.createdAt,
  };
}

describe('NotificationService.listPaginated', () => {
  it('scopes queries to the caller (recipientId) and applies newest-first ordering', async () => {
    const { service, prisma } = setup();
    prisma.notification.findMany.mockResolvedValueOnce([] as never);

    await service.listPaginated(actor, { limit: 10 });

    const call = prisma.notification.findMany.mock.calls[0]?.[0];
    expect(call?.where).toMatchObject({ recipientId: 'u-1' });
    expect(call?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('overfetches by 1 to detect hasMore', async () => {
    const { service, prisma } = setup();
    prisma.notification.findMany.mockResolvedValueOnce([] as never);

    await service.listPaginated(actor, { limit: 5 });
    expect(prisma.notification.findMany.mock.calls[0]?.[0]?.take).toBe(6);
  });

  it('clamps limit to [1, 100]', async () => {
    const { service, prisma } = setup();
    prisma.notification.findMany.mockResolvedValue([] as never);

    await service.listPaginated(actor, { limit: 500 });
    expect(prisma.notification.findMany.mock.calls[0]?.[0]?.take).toBe(101);

    prisma.notification.findMany.mockClear();
    await service.listPaginated(actor, { limit: 0 });
    expect(prisma.notification.findMany.mock.calls[0]?.[0]?.take).toBe(2);
  });

  it('applies unreadOnly=true as a readAt IS NULL filter', async () => {
    const { service, prisma } = setup();
    prisma.notification.findMany.mockResolvedValueOnce([] as never);

    await service.listPaginated(actor, { unreadOnly: true });
    const call = prisma.notification.findMany.mock.calls[0]?.[0];
    expect(call?.where).toMatchObject({ recipientId: 'u-1', readAt: null });
  });

  it('returns nextCursor=null when the DB returns take-or-fewer rows', async () => {
    const { service, prisma } = setup();
    prisma.notification.findMany.mockResolvedValueOnce([
      row({ id: 'n1', createdAt: new Date('2026-08-01T10:00:00Z') }),
    ] as never);

    const page = await service.listPaginated(actor, { limit: 5 });
    expect(page.rows).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('encodes nextCursor pointing to the LAST returned row when overfetched', async () => {
    const { service, prisma } = setup();
    prisma.notification.findMany.mockResolvedValueOnce([
      row({ id: 'n1', createdAt: new Date('2026-08-01T10:00:00Z') }),
      row({ id: 'n2', createdAt: new Date('2026-08-01T09:00:00Z') }),
      row({ id: 'n3', createdAt: new Date('2026-08-01T08:00:00Z') }),
      row({ id: 'n4', createdAt: new Date('2026-08-01T07:00:00Z') }),
    ] as never);

    const page = await service.listPaginated(actor, { limit: 3 });
    expect(page.rows).toHaveLength(3);
    expect(page.nextCursor).not.toBeNull();

    const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString('utf8'));
    // Anchor MUST be n3 (the last row we're returning), not n4 (the
    // overfetched, dropped row) — otherwise page 2 would skip n3.
    expect(decoded.id).toBe('n3');
    expect(decoded.createdAt).toBe('2026-08-01T08:00:00.000Z');
  });

  it('applies a cursor as a keyset predicate on the next call', async () => {
    const { service, prisma } = setup();
    // Page 1
    prisma.notification.findMany.mockResolvedValueOnce([
      row({ id: 'n1', createdAt: new Date('2026-08-01T10:00:00Z') }),
      row({ id: 'n2', createdAt: new Date('2026-08-01T09:00:00Z') }),
      row({ id: 'n3', createdAt: new Date('2026-08-01T08:00:00Z') }),
      row({ id: 'n4', createdAt: new Date('2026-08-01T07:00:00Z') }),
    ] as never);
    const p1 = await service.listPaginated(actor, { limit: 3 });

    prisma.notification.findMany.mockResolvedValueOnce([] as never);
    await service.listPaginated(actor, { limit: 3, cursor: p1.nextCursor! });

    const call = prisma.notification.findMany.mock.calls[1]?.[0];
    expect(call?.where).toMatchObject({
      recipientId: 'u-1',
      OR: [
        { createdAt: { lt: new Date('2026-08-01T08:00:00.000Z') } },
        {
          createdAt: new Date('2026-08-01T08:00:00.000Z'),
          id: { lt: 'n3' },
        },
      ],
    });
  });

  it('rejects a malformed cursor with 400 INVALID_CURSOR', async () => {
    const { service } = setup();
    await expect(service.listPaginated(actor, { cursor: 'not-real-b64' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('projects readAt as ISO string (or null) — matches the flat `list` shape', async () => {
    const { service, prisma } = setup();
    const readAt = new Date('2026-08-01T05:00:00Z');
    prisma.notification.findMany.mockResolvedValueOnce([
      row({
        id: 'n1',
        createdAt: new Date('2026-08-01T10:00:00Z'),
        readAt,
      }),
      row({ id: 'n2', createdAt: new Date('2026-08-01T09:00:00Z') }),
    ] as never);

    const page = await service.listPaginated(actor, { limit: 10 });
    expect(page.rows[0]?.readAt).toBe(readAt.toISOString());
    expect(page.rows[1]?.readAt).toBeNull();
    expect(typeof page.rows[0]?.createdAt).toBe('string');
  });
});
