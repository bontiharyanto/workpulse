import { planNextAttempt, RETRY_SCHEDULE_MS } from './retry-schedule';

describe('planNextAttempt (Fase 32e)', () => {
  const NOW = 1_800_000_000_000;

  it('returns 30s delay for the first retry (previousCount = 0)', () => {
    const plan = planNextAttempt(0, 4, NOW);
    expect(plan).not.toBeNull();
    expect(plan!.attemptCount).toBe(1);
    expect(plan!.nextAttemptAt.getTime() - NOW).toBe(30_000);
  });

  it('returns 5m delay for the second retry', () => {
    const plan = planNextAttempt(1, 4, NOW);
    expect(plan!.nextAttemptAt.getTime() - NOW).toBe(5 * 60_000);
    expect(plan!.attemptCount).toBe(2);
  });

  it('returns 30m delay for the third retry', () => {
    const plan = planNextAttempt(2, 4, NOW);
    expect(plan!.nextAttemptAt.getTime() - NOW).toBe(30 * 60_000);
    expect(plan!.attemptCount).toBe(3);
  });

  it('returns null once retries are exhausted (nextCount === max)', () => {
    // previousAttemptCount=3, maxAttempts=4 -> nextCount=4, terminal.
    expect(planNextAttempt(3, 4, NOW)).toBeNull();
  });

  it('respects an increased maxAttempts', () => {
    // With maxAttempts=5 the 4th retry uses the 6h slot.
    const plan = planNextAttempt(3, 5, NOW);
    expect(plan).not.toBeNull();
    expect(plan!.nextAttemptAt.getTime() - NOW).toBe(RETRY_SCHEDULE_MS[4] ?? 0);
    expect(plan!.attemptCount).toBe(4);
  });

  it('never indexes past the schedule table', () => {
    // maxAttempts higher than table length — should clamp to the last slot.
    const lastSlot = RETRY_SCHEDULE_MS[RETRY_SCHEDULE_MS.length - 1] ?? 0;
    const plan = planNextAttempt(RETRY_SCHEDULE_MS.length + 2, 100, NOW);
    expect(plan!.nextAttemptAt.getTime() - NOW).toBe(lastSlot);
  });
});
