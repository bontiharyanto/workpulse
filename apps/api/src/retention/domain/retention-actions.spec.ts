import type { Prisma } from '@prisma/client';

import { listAutoErasureCandidates, pruneNotifications } from './retention-actions';

describe('pruneNotifications', () => {
  it('returns 0 and skips the delete when retention is disabled', async () => {
    const deleteMany = jest.fn();
    const tx = {
      notification: { deleteMany },
    } as unknown as Prisma.TransactionClient;

    const count = await pruneNotifications(tx, 'c-1', 0, new Date());
    expect(count).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('deletes notifications older than the retention window', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 5 });
    const tx = {
      notification: { deleteMany },
    } as unknown as Prisma.TransactionClient;
    const now = new Date('2026-08-02T00:00:00Z');

    const count = await pruneNotifications(tx, 'c-1', 30, now);
    expect(count).toBe(5);
    const args = deleteMany.mock.calls[0][0];
    // Cutoff should be now - 30d.
    expect(args.where.companyId).toBe('c-1');
    const cutoffMs = (args.where.createdAt.lt as Date).getTime();
    expect(now.getTime() - cutoffMs).toBe(30 * 86_400_000);
  });
});

describe('listAutoErasureCandidates', () => {
  it('returns [] when anonymize days is 0', async () => {
    const findMany = jest.fn();
    const tx = {
      user: { findMany },
    } as unknown as Prisma.TransactionClient;

    const rows = await listAutoErasureCandidates(tx, 'c-1', 0, new Date());
    expect(rows).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('scopes to TERMINATED users past the threshold and excludes already-anonymized rows', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = {
      user: { findMany },
    } as unknown as Prisma.TransactionClient;
    const now = new Date('2026-08-02T00:00:00Z');

    await listAutoErasureCandidates(tx, 'c-1', 60, now);

    const args = findMany.mock.calls[0][0];
    expect(args.where.companyId).toBe('c-1');
    expect(args.where.employmentStatus).toBe('TERMINATED');
    // Cutoff = now - 60d.
    const cutoffMs = (args.where.deletedAt.lt as Date).getTime();
    expect(now.getTime() - cutoffMs).toBe(60 * 86_400_000);
    // Excludes rows already carrying the erased sentinel.
    expect(args.where.NOT).toEqual({
      email: { endsWith: '@workpulse.deleted' },
    });
  });
});
