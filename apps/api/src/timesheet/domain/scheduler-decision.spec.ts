import {
  daysBetweenYmd,
  decideApprovalReminder,
  decideAutoGenerate,
  decideSubmitReminder,
  todayInTz,
} from './scheduler-decision';

describe('scheduler-decision — Fase 32f pure logic', () => {
  describe('todayInTz', () => {
    it('projects the same instant to different tenant calendar days', () => {
      // 2026-08-03T22:30:00Z → 03 Aug in Jakarta, 03 Aug in London, 04 Aug in Sydney.
      const at = new Date('2026-08-03T22:30:00Z');
      expect(todayInTz(at, 'Asia/Jakarta')).toBe('2026-08-04'); // 05:30
      expect(todayInTz(at, 'Europe/London')).toBe('2026-08-03'); // 23:30
      expect(todayInTz(at, 'Australia/Sydney')).toBe('2026-08-04'); // 08:30 next day
    });
  });

  describe('daysBetweenYmd', () => {
    it('returns whole-day differences ignoring hours', () => {
      expect(daysBetweenYmd('2026-08-01', '2026-08-01')).toBe(0);
      expect(daysBetweenYmd('2026-08-01', '2026-08-08')).toBe(7);
      expect(daysBetweenYmd('2026-08-08', '2026-08-01')).toBe(-7);
    });

    it('handles month + year boundaries', () => {
      expect(daysBetweenYmd('2025-12-31', '2026-01-01')).toBe(1);
      expect(daysBetweenYmd('2026-02-28', '2026-03-01')).toBe(1);
    });
  });

  describe('decideAutoGenerate', () => {
    it('SKIP when auto-generation is disabled', () => {
      const d = decideAutoGenerate({
        autoGenerateEnabled: false,
        latestPeriodEndYmd: '2026-07-31',
        todayYmd: '2026-08-01',
      });
      expect(d).toEqual({ fire: false, reason: 'DISABLED' });
    });

    it('INITIAL fire when there is no period yet', () => {
      const d = decideAutoGenerate({
        autoGenerateEnabled: true,
        latestPeriodEndYmd: null,
        todayYmd: '2026-08-01',
      });
      expect(d).toEqual({ fire: true, reason: 'INITIAL' });
    });

    it('SKIP when today is inside the latest period', () => {
      const d = decideAutoGenerate({
        autoGenerateEnabled: true,
        latestPeriodEndYmd: '2026-08-31',
        todayYmd: '2026-08-15',
      });
      expect(d).toEqual({ fire: false, reason: 'NOT_YET_DUE' });
    });

    it('SKIP when today equals the latest periodEnd (still inside)', () => {
      const d = decideAutoGenerate({
        autoGenerateEnabled: true,
        latestPeriodEndYmd: '2026-08-31',
        todayYmd: '2026-08-31',
      });
      expect(d).toEqual({ fire: false, reason: 'NOT_YET_DUE' });
    });

    it('NEXT_PERIOD fire when today is after the latest periodEnd', () => {
      const d = decideAutoGenerate({
        autoGenerateEnabled: true,
        latestPeriodEndYmd: '2026-07-31',
        todayYmd: '2026-08-01',
      });
      expect(d).toEqual({ fire: true, reason: 'NEXT_PERIOD' });
    });
  });

  describe('decideSubmitReminder', () => {
    const base = {
      reminderEnabled: true,
      submitReminderStartDays: 1,
      submitReminderMaxDays: 7,
      periodEndYmd: '2026-07-31',
      timesheetStatus: 'DRAFT' as const,
    };

    it('SKIP when reminders disabled tenant-wide', () => {
      const d = decideSubmitReminder({
        ...base,
        reminderEnabled: false,
        todayYmd: '2026-08-05',
      });
      expect(d).toEqual({ fire: false, reason: 'DISABLED' });
    });

    it('SKIP when status is not DRAFT / REJECTED', () => {
      const d = decideSubmitReminder({
        ...base,
        timesheetStatus: 'PENDING_SUPERVISOR',
        todayYmd: '2026-08-05',
      });
      expect(d.fire).toBe(false);
      if (!d.fire) expect(d.reason).toBe('STATUS_NOT_PENDING_SUBMIT');
    });

    it('REJECTED counts as pending resubmit', () => {
      const d = decideSubmitReminder({
        ...base,
        timesheetStatus: 'REJECTED',
        todayYmd: '2026-08-02',
      });
      expect(d.fire).toBe(true);
    });

    it('SKIP too early (before start window)', () => {
      const d = decideSubmitReminder({ ...base, todayYmd: '2026-07-31' });
      expect(d.fire).toBe(false);
    });

    it('FIRE on the first eligible day', () => {
      const d = decideSubmitReminder({ ...base, todayYmd: '2026-08-01' });
      expect(d.fire).toBe(true);
    });

    it('FIRE on the LAST eligible day', () => {
      const d = decideSubmitReminder({ ...base, todayYmd: '2026-08-07' });
      expect(d.fire).toBe(true);
    });

    it('SKIP past the max window', () => {
      const d = decideSubmitReminder({ ...base, todayYmd: '2026-08-08' });
      expect(d.fire).toBe(false);
      if (!d.fire) expect(d.reason).toBe('TOO_LATE');
    });
  });

  describe('decideApprovalReminder', () => {
    const base = {
      reminderEnabled: true,
      approvalReminderStartDays: 2,
      approvalReminderMaxDays: 14,
      periodEndYmd: '2026-07-31',
    };

    it('SKIP when status is DRAFT (not in an approver queue)', () => {
      const d = decideApprovalReminder({
        ...base,
        todayYmd: '2026-08-05',
        timesheetStatus: 'DRAFT',
      });
      expect(d.fire).toBe(false);
    });

    it('FIRE with SUPERVISOR queue when PENDING_SUPERVISOR + inside window', () => {
      const d = decideApprovalReminder({
        ...base,
        todayYmd: '2026-08-05',
        timesheetStatus: 'PENDING_SUPERVISOR',
      });
      expect(d).toEqual({ fire: true, targetQueue: 'SUPERVISOR' });
    });

    it('FIRE with HR queue when PENDING_HR', () => {
      const d = decideApprovalReminder({
        ...base,
        todayYmd: '2026-08-10',
        timesheetStatus: 'PENDING_HR',
      });
      expect(d).toEqual({ fire: true, targetQueue: 'HR' });
    });

    it('SKIP when past max window', () => {
      const d = decideApprovalReminder({
        ...base,
        todayYmd: '2026-08-20',
        timesheetStatus: 'PENDING_HR',
      });
      expect(d.fire).toBe(false);
    });
  });
});
