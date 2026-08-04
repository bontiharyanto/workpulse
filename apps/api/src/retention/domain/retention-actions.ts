import type { Prisma } from '@prisma/client';

/**
 * Prune `Notification` rows for a tenant that predate the retention
 * window. Executed inside the caller's transaction so the audit
 * write is atomic with the delete.
 *
 * `retentionDays === 0` disables the sweep entirely (the caller
 * should never invoke this helper in that case; we defend anyway
 * for correctness).
 */
export async function pruneNotifications(
  tx: Prisma.TransactionClient,
  companyId: string,
  retentionDays: number,
  now: Date,
): Promise<number> {
  if (retentionDays <= 0) return 0;
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  const result = await tx.notification.deleteMany({
    where: {
      companyId,
      createdAt: { lt: cutoff },
    },
  });
  return result.count;
}

/**
 * Return the set of TERMINATED users whose `deletedAt` predates the
 * auto-anonymise threshold AND who have NOT already been anonymised
 * (detected by the `@workpulse.deleted` sentinel email).
 *
 * `anonymizeDays === 0` disables the sweep — return an empty list.
 *
 * We return IDs rather than rows so the caller can invoke the
 * existing `anonymizeUser` helper in its own transaction per user:
 * an anonymisation is a moderately expensive multi-table write, and
 * batching them all into one giant transaction would hold locks for
 * far too long.
 */
export async function listAutoErasureCandidates(
  tx: Prisma.TransactionClient,
  companyId: string,
  anonymizeDays: number,
  now: Date,
  limit = 25,
): Promise<Array<{ id: string; email: string; deletedAt: Date }>> {
  if (anonymizeDays <= 0) return [];
  const cutoff = new Date(now.getTime() - anonymizeDays * 86_400_000);
  return tx.user.findMany({
    where: {
      companyId,
      employmentStatus: 'TERMINATED',
      deletedAt: { not: null, lt: cutoff },
      // Skip already-anonymised rows so a re-run is idempotent.
      // The sentinel domain is globally unique for erased users.
      NOT: { email: { endsWith: '@workpulse.deleted' } },
    },
    orderBy: { deletedAt: 'asc' },
    take: limit,
    select: { id: true, email: true, deletedAt: true },
  }) as Promise<Array<{ id: string; email: string; deletedAt: Date }>>;
}
