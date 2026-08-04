import { BadRequestException } from '@nestjs/common';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import { AuditService } from './audit.service';

function setup(): {
  service: AuditService;
  prisma: DeepMockProxy<PrismaService>;
} {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  prisma.auditLog.findMany.mockResolvedValue([] as never);
  const service = new AuditService(prisma);
  return { service, prisma };
}

const actor: AuthenticatedUser = {
  id: 'u-hr',
  companyId: 'co-1',
  departmentId: null,
  email: 'hr@example.com',
  role: 'HR_MANAGER',
};

/**
 * Build a fake AuditLog row that matches the Prisma select the service
 * issues. Cast broadly because the mock isn't type-aware.
 */
function row(overrides: {
  id: string;
  createdAt: Date;
  action?: string;
  entityType?: string;
  entityId?: string;
  actor?: { fullName: string; email: string } | null;
}): unknown {
  return {
    id: overrides.id,
    action: overrides.action ?? 'LEAVE_REQUEST_APPROVED',
    entityType: overrides.entityType ?? 'LeaveRequest',
    entityId: overrides.entityId ?? 'lr-1',
    actorId: 'u-hr',
    beforeJson: null,
    afterJson: { status: 'APPROVED' },
    ip: '127.0.0.1',
    userAgent: 'jest',
    createdAt: overrides.createdAt,
    actor:
      overrides.actor === null
        ? null
        : (overrides.actor ?? { fullName: 'HR Test', email: 'hr@example.com' }),
  };
}

describe('AuditService.list — filters + tenancy', () => {
  it('always scopes by actor.companyId', async () => {
    const s = setup();
    await s.service.list(actor, {}, undefined, 10);
    const call = s.prisma.auditLog.findMany.mock.calls[0]?.[0];
    expect(call?.where).toMatchObject({ companyId: 'co-1' });
  });

  it('applies entityType + entityId filters when present', async () => {
    const s = setup();
    await s.service.list(actor, { entityType: 'LeaveRequest', entityId: 'lr-1' }, undefined, 10);
    const call = s.prisma.auditLog.findMany.mock.calls[0]?.[0];
    expect(call?.where).toMatchObject({
      companyId: 'co-1',
      entityType: 'LeaveRequest',
      entityId: 'lr-1',
    });
  });

  it('applies actorId + action filters when present', async () => {
    const s = setup();
    await s.service.list(
      actor,
      { actorId: 'u-1', action: 'LEAVE_REQUEST_APPROVED' },
      undefined,
      10,
    );
    const call = s.prisma.auditLog.findMany.mock.calls[0]?.[0];
    expect(call?.where).toMatchObject({
      actorId: 'u-1',
      action: 'LEAVE_REQUEST_APPROVED',
    });
  });

  it('applies from/to as an inclusive range on createdAt', async () => {
    const s = setup();
    const from = new Date('2026-07-01T00:00:00Z');
    const to = new Date('2026-08-01T00:00:00Z');
    await s.service.list(actor, { from, to }, undefined, 10);
    const call = s.prisma.auditLog.findMany.mock.calls[0]?.[0];
    expect(call?.where).toMatchObject({
      createdAt: { gte: from, lte: to },
    });
  });

  it('orders by (createdAt desc, id desc)', async () => {
    const s = setup();
    await s.service.list(actor, {}, undefined, 10);
    const call = s.prisma.auditLog.findMany.mock.calls[0]?.[0];
    expect(call?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });
});

describe('AuditService.list — pagination', () => {
  it('overfetches by 1 to detect hasMore', async () => {
    const s = setup();
    await s.service.list(actor, {}, undefined, 5);
    const call = s.prisma.auditLog.findMany.mock.calls[0]?.[0];
    expect(call?.take).toBe(6);
  });

  it('clamps limit to [1, MAX_LIMIT] (100 upper, 1 lower)', async () => {
    const s = setup();

    await s.service.list(actor, {}, undefined, 500);
    expect(s.prisma.auditLog.findMany.mock.calls[0]?.[0]?.take).toBe(101);

    s.prisma.auditLog.findMany.mockClear();
    await s.service.list(actor, {}, undefined, 0);
    expect(s.prisma.auditLog.findMany.mock.calls[0]?.[0]?.take).toBe(2);

    s.prisma.auditLog.findMany.mockClear();
    await s.service.list(actor, {}, undefined, -5);
    expect(s.prisma.auditLog.findMany.mock.calls[0]?.[0]?.take).toBe(2);
  });

  it('returns nextCursor=null when Prisma returns take-or-fewer rows', async () => {
    const s = setup();
    s.prisma.auditLog.findMany.mockResolvedValue([
      row({ id: 'a1', createdAt: new Date('2026-08-01T10:00:00Z') }),
      row({ id: 'a2', createdAt: new Date('2026-08-01T09:00:00Z') }),
    ] as never);
    const page = await s.service.list(actor, {}, undefined, 5);
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('returns a nextCursor encoding the last returned row when overfetched', async () => {
    const s = setup();
    // 3 rows requested; overfetch=4 → service will return 3 and encode
    // the 3rd row's (createdAt, id) as the cursor.
    s.prisma.auditLog.findMany.mockResolvedValue([
      row({ id: 'a1', createdAt: new Date('2026-08-01T10:00:00Z') }),
      row({ id: 'a2', createdAt: new Date('2026-08-01T09:00:00Z') }),
      row({ id: 'a3', createdAt: new Date('2026-08-01T08:00:00Z') }),
      row({ id: 'a4', createdAt: new Date('2026-08-01T07:00:00Z') }),
    ] as never);
    const page = await s.service.list(actor, {}, undefined, 3);
    expect(page.rows).toHaveLength(3);
    expect(page.nextCursor).not.toBeNull();
    // Decode & verify — the cursor must point at the LAST returned row
    // (a3), not the dropped row (a4). Otherwise the next page would
    // skip a3.
    const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString('utf8'));
    expect(decoded.id).toBe('a3');
    expect(decoded.createdAt).toBe('2026-08-01T08:00:00.000Z');
  });

  it('applies a cursor as a keyset predicate on the next call', async () => {
    const s = setup();
    // First call: produces cursor at (a3, T=08:00).
    s.prisma.auditLog.findMany.mockResolvedValueOnce([
      row({ id: 'a1', createdAt: new Date('2026-08-01T10:00:00Z') }),
      row({ id: 'a2', createdAt: new Date('2026-08-01T09:00:00Z') }),
      row({ id: 'a3', createdAt: new Date('2026-08-01T08:00:00Z') }),
      row({ id: 'a4', createdAt: new Date('2026-08-01T07:00:00Z') }),
    ] as never);
    const first = await s.service.list(actor, {}, undefined, 3);

    s.prisma.auditLog.findMany.mockResolvedValueOnce([] as never);
    await s.service.list(actor, {}, first.nextCursor ?? undefined, 3);

    const call = s.prisma.auditLog.findMany.mock.calls[1]?.[0];
    expect(call?.where).toMatchObject({
      companyId: 'co-1',
      OR: [
        { createdAt: { lt: new Date('2026-08-01T08:00:00.000Z') } },
        {
          createdAt: new Date('2026-08-01T08:00:00.000Z'),
          id: { lt: 'a3' },
        },
      ],
    });
  });

  it('rejects a malformed cursor with 400 INVALID_CURSOR', async () => {
    const s = setup();
    await expect(s.service.list(actor, {}, 'not-base64-json', 10)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a cursor with missing/invalid fields', async () => {
    const s = setup();
    const bad = Buffer.from(JSON.stringify({ id: 'x' }), 'utf8').toString('base64url');
    await expect(s.service.list(actor, {}, bad, 10)).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// iterate() — Fase 26 NDJSON export generator
// ---------------------------------------------------------------------------

describe('AuditService.iterate — batching + termination', () => {
  it('short-reads terminates the loop after one batch', async () => {
    const s = setup();
    s.prisma.auditLog.findMany.mockResolvedValueOnce([
      row({ id: 'a1', createdAt: new Date('2026-08-01T10:00:00Z') }),
      row({ id: 'a2', createdAt: new Date('2026-08-01T09:00:00Z') }),
    ] as never);

    const rows = [] as unknown[];
    for await (const r of s.service.iterate(actor, {}, { batchSize: 100 })) {
      rows.push(r);
    }
    expect(rows).toHaveLength(2);
    // Short-read means we don't schedule a next round-trip.
    expect(s.prisma.auditLog.findMany).toHaveBeenCalledTimes(1);
  });

  it('paginates through multiple full batches until natural end', async () => {
    const s = setup();
    // Batch size 3, three batches: full, full, partial → total 8.
    s.prisma.auditLog.findMany
      .mockResolvedValueOnce([
        row({ id: 'a1', createdAt: new Date('2026-08-01T10:00:00Z') }),
        row({ id: 'a2', createdAt: new Date('2026-08-01T09:00:00Z') }),
        row({ id: 'a3', createdAt: new Date('2026-08-01T08:00:00Z') }),
      ] as never)
      .mockResolvedValueOnce([
        row({ id: 'a4', createdAt: new Date('2026-08-01T07:00:00Z') }),
        row({ id: 'a5', createdAt: new Date('2026-08-01T06:00:00Z') }),
        row({ id: 'a6', createdAt: new Date('2026-08-01T05:00:00Z') }),
      ] as never)
      .mockResolvedValueOnce([
        row({ id: 'a7', createdAt: new Date('2026-08-01T04:00:00Z') }),
        row({ id: 'a8', createdAt: new Date('2026-08-01T03:00:00Z') }),
      ] as never);

    const collected: string[] = [];
    for await (const r of s.service.iterate(actor, {}, { batchSize: 3 })) {
      collected.push((r as { id: string }).id);
    }
    expect(collected).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']);
    expect(s.prisma.auditLog.findMany).toHaveBeenCalledTimes(3);
  });

  it('honors maxRows even when data would produce more', async () => {
    const s = setup();
    // Batch 3 always full → without cap we'd keep going. Cap at 5.
    s.prisma.auditLog.findMany
      .mockResolvedValueOnce([
        row({ id: 'a1', createdAt: new Date('2026-08-01T10:00:00Z') }),
        row({ id: 'a2', createdAt: new Date('2026-08-01T09:00:00Z') }),
        row({ id: 'a3', createdAt: new Date('2026-08-01T08:00:00Z') }),
      ] as never)
      .mockResolvedValueOnce([
        row({ id: 'a4', createdAt: new Date('2026-08-01T07:00:00Z') }),
        row({ id: 'a5', createdAt: new Date('2026-08-01T06:00:00Z') }),
        // last batch takes only 2 because remaining=2
      ] as never);

    const collected: string[] = [];
    for await (const r of s.service.iterate(
      actor,
      {},
      {
        batchSize: 3,
        maxRows: 5,
      },
    )) {
      collected.push((r as { id: string }).id);
    }
    expect(collected).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    // Second call take is clamped to remaining (2), not batchSize (3).
    const secondCall = s.prisma.auditLog.findMany.mock.calls[1]?.[0];
    expect(secondCall?.take).toBe(2);
    // No third round-trip.
    expect(s.prisma.auditLog.findMany).toHaveBeenCalledTimes(2);
  });

  it('propagates filters into every batched query', async () => {
    const s = setup();
    s.prisma.auditLog.findMany.mockResolvedValueOnce([] as never);
    for await (const _ of s.service.iterate(
      actor,
      { action: 'LEAVE_REQUEST_APPROVED', entityType: 'LeaveRequest' },
      { batchSize: 100 },
    )) {
      void _;
    }
    const call = s.prisma.auditLog.findMany.mock.calls[0]?.[0];
    expect(call?.where).toMatchObject({
      companyId: 'co-1',
      action: 'LEAVE_REQUEST_APPROVED',
      entityType: 'LeaveRequest',
    });
  });

  it('applies keyset predicate on the SECOND batch (cursored from batch 1)', async () => {
    const s = setup();
    s.prisma.auditLog.findMany
      .mockResolvedValueOnce([
        row({ id: 'a1', createdAt: new Date('2026-08-01T10:00:00Z') }),
        row({ id: 'a2', createdAt: new Date('2026-08-01T09:00:00Z') }),
      ] as never)
      .mockResolvedValueOnce([] as never);

    for await (const _ of s.service.iterate(actor, {}, { batchSize: 2 })) {
      void _;
    }
    const call2 = s.prisma.auditLog.findMany.mock.calls[1]?.[0];
    // Cursor should be pointing at a2 (last row of batch 1).
    expect(call2?.where).toMatchObject({
      companyId: 'co-1',
      OR: [
        { createdAt: { lt: new Date('2026-08-01T09:00:00.000Z') } },
        {
          createdAt: new Date('2026-08-01T09:00:00.000Z'),
          id: { lt: 'a2' },
        },
      ],
    });
  });

  it('clamps batchSize upper bound to 2000 and maxRows to [1, 1_000_000]', async () => {
    const s = setup();
    s.prisma.auditLog.findMany.mockResolvedValueOnce([] as never);
    for await (const _ of s.service.iterate(
      actor,
      {},
      {
        batchSize: 999_999, // above cap 2000
        maxRows: 500,
      },
    )) {
      void _;
    }
    // Clamped: min(2000, 500 remaining) = 500.
    const call = s.prisma.auditLog.findMany.mock.calls[0]?.[0];
    expect(call?.take).toBe(500);
  });

  it('clamps a zero/negative batchSize up to 1 (never asks Postgres for zero rows)', async () => {
    const s = setup();
    s.prisma.auditLog.findMany.mockResolvedValueOnce([] as never);
    for await (const _ of s.service.iterate(
      actor,
      {},
      {
        batchSize: 0,
        maxRows: 5,
      },
    )) {
      void _;
    }
    const call = s.prisma.auditLog.findMany.mock.calls[0]?.[0];
    expect(call?.take).toBe(1);
  });
});

describe('AuditService.list — projection', () => {
  it('surfaces actor.fullName and actor.email alongside actorId', async () => {
    const s = setup();
    s.prisma.auditLog.findMany.mockResolvedValue([
      row({
        id: 'a1',
        createdAt: new Date('2026-08-01T10:00:00Z'),
        actor: { fullName: 'HR Manager', email: 'hr@acme.test' },
      }),
    ] as never);
    const page = await s.service.list(actor, {}, undefined, 10);
    expect(page.rows[0]).toMatchObject({
      actorId: 'u-hr',
      actorName: 'HR Manager',
      actorEmail: 'hr@acme.test',
    });
  });

  it('tolerates a null actor relation (soft-deleted user)', async () => {
    // AuditLog.actor is `Restrict` on delete, but a soft-deleted actor
    // (User.deletedAt != null) would still return the row. Just make
    // sure we don't crash.
    const s = setup();
    s.prisma.auditLog.findMany.mockResolvedValue([
      row({
        id: 'a1',
        createdAt: new Date('2026-08-01T10:00:00Z'),
        actor: null,
      }),
    ] as never);
    const page = await s.service.list(actor, {}, undefined, 10);
    expect(page.rows[0]?.actorName).toBeNull();
    expect(page.rows[0]?.actorEmail).toBeNull();
  });
});
