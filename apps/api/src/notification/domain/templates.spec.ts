import {
  attendanceAbsentMarked,
  leaveApprovedByHr,
  leaveApprovedBySupervisor,
  leaveRejected,
  leaveSubmitted,
  overtimeApproved,
  overtimeCompleted,
  overtimeRejected,
  overtimeSubmitted,
  passwordResetSucceeded,
} from './templates';

const leaveInput = {
  leaveRequestId: 'lr-1',
  requesterName: 'Budi Santoso',
  leaveTypeName: 'Cuti Tahunan',
  startDate: '2026-09-01',
  endDate: '2026-09-03',
  days: 3,
};

const otInput = {
  overtimeRequestId: 'ot-1',
  requesterName: 'Budi Santoso',
  workDate: '2026-08-30',
  hours: 3.5,
};

describe('notification templates — leave', () => {
  it('leaveSubmitted embeds requester + range + deep link', () => {
    const c = leaveSubmitted(leaveInput);
    expect(c.type).toBe('LEAVE_SUBMITTED');
    expect(c.title).toContain('Budi Santoso');
    expect(c.body).toContain('Cuti Tahunan');
    expect(c.body).toContain('3 hari');
    expect(c.body).toContain('2026-09-01');
    expect(c.data).toEqual({ leaveRequestId: 'lr-1', href: '/leave/approvals' });
  });

  it('leaveApprovedBySupervisor targets the employee page, not the approvals queue', () => {
    const c = leaveApprovedBySupervisor(leaveInput);
    expect(c.data).toEqual({ leaveRequestId: 'lr-1', href: '/leave' });
    expect(c.body).toContain('HR');
  });

  it('leaveApprovedByHr uses a celebratory tone (final approval)', () => {
    const c = leaveApprovedByHr(leaveInput);
    expect(c.body).toContain('Selamat');
  });

  it('leaveRejected includes rejecter name and truncated note', () => {
    const c = leaveRejected({
      ...leaveInput,
      decidedByName: 'HR Manager',
      note: 'a'.repeat(200),
    });
    expect(c.body).toContain('HR Manager');
    // Note is truncated to 160 chars + ellipsis.
    expect(c.body).toContain('…');
    expect(c.body.length).toBeLessThan(400);
  });

  it('leaveRejected omits note suffix when no note provided', () => {
    const c = leaveRejected({ ...leaveInput, decidedByName: 'Bos' });
    expect(c.body).not.toContain('Catatan:');
  });
});

describe('notification templates — overtime', () => {
  it('overtimeSubmitted references hours + workDate + approvals link', () => {
    const c = overtimeSubmitted(otInput);
    expect(c.title).toContain('Budi Santoso');
    expect(c.body).toContain('3.5 jam');
    expect(c.body).toContain('2026-08-30');
    expect(c.data).toEqual({ overtimeRequestId: 'ot-1', href: '/overtime/approvals' });
  });

  it('overtimeApproved mentions decider if present', () => {
    const c = overtimeApproved({ ...otInput, decidedByName: 'Team Lead' });
    expect(c.body).toContain('Team Lead');
  });

  it('overtimeRejected mentions decider + note', () => {
    const c = overtimeRejected({ ...otInput, decidedByName: 'Team Lead', note: 'tidak urgent' });
    expect(c.body).toContain('Team Lead');
    expect(c.body).toContain('tidak urgent');
  });

  it('overtimeCompleted is scheduler-authored (no decider name)', () => {
    const c = overtimeCompleted(otInput);
    expect(c.type).toBe('OVERTIME_COMPLETED');
    expect(c.body).toContain('diverifikasi');
    expect(c.body).toContain('siap dibayar');
  });
});

describe('notification templates — password reset', () => {
  it('passwordResetSucceeded omits the used reset link (security)', () => {
    const c = passwordResetSucceeded({});
    expect(c.type).toBe('PASSWORD_RESET');
    expect(c.body).toContain('direset');
    expect(c.body).toContain('HR');
    // No href → the notification is informational, not actionable.
    expect((c.data as { requiresAction?: boolean }).requiresAction).toBe(false);
  });

  it('passwordResetSucceeded appends IP + user-agent hints when supplied', () => {
    const c = passwordResetSucceeded({
      ipAddress: '10.0.0.1',
      userAgent: 'Mozilla/5.0 (Test)',
    });
    expect(c.body).toContain('10.0.0.1');
    expect(c.body).toContain('Mozilla/5.0');
  });

  it('passwordResetSucceeded truncates absurdly long user agents', () => {
    const c = passwordResetSucceeded({ userAgent: 'x'.repeat(500) });
    expect(c.body).toContain('…');
    expect(c.body.length).toBeLessThan(400);
  });
});

describe('notification templates — attendance absent', () => {
  const base = {
    workDate: '2026-08-01',
    employeeName: 'Ana Wijaya',
    forSupervisor: false,
  };

  it('employee variant softens tone + directs to /attendance/history for dispute', () => {
    const c = attendanceAbsentMarked(base);
    expect(c.type).toBe('ATTENDANCE_ABSENT_MARKED');
    expect(c.title).toContain('tidak hadir');
    expect(c.body).toContain('HR');
    expect((c.data as { href?: string }).href).toBe('/attendance/history');
  });

  it('supervisor variant names the employee + links to team view', () => {
    const c = attendanceAbsentMarked({ ...base, forSupervisor: true });
    expect(c.title).toContain('Ana Wijaya');
    expect(c.body).toContain('Ana Wijaya');
    expect((c.data as { href?: string }).href).toBe('/attendance/team?date=2026-08-01');
  });

  it('embeds the workDate in the data payload for deep-link filtering', () => {
    const c = attendanceAbsentMarked(base);
    expect((c.data as { workDate?: string }).workDate).toBe('2026-08-01');
  });
});
