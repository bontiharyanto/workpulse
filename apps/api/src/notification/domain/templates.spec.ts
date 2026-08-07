import {
  attendanceAbsentMarked,
  leaveApprovedByHr,
  leaveApprovedBySupervisor,
  leaveRejected,
  leaveSubmitted,
  locationShareRequested,
  locationShareResponded,
  locationShareViewed,
  locationSharingConsentChanged,
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

// ---------------------------------------------------------------------------
// Location sharing (ADR-0041) — every template must:
//   1. embed a deep link the FE can navigate to
//   2. state the reason / actor
//   3. never leak coordinates into the body (retention lives elsewhere)
// ---------------------------------------------------------------------------

describe('notification templates — location sharing', () => {
  it('locationShareRequested reads first-person, embeds reason, links to inbox', () => {
    const c = locationShareRequested({
      requestId: 'req-1',
      supervisorName: 'Rani (Supervisor)',
      reason: 'konfirmasi kehadiran di lokasi klien A',
      expiresAt: '2026-08-07T08:15:00.000Z',
    });
    expect(c.type).toBe('LOCATION_SHARE_REQUESTED');
    expect(c.title).toContain('Rani (Supervisor)');
    expect(c.body).toContain('konfirmasi kehadiran');
    expect(c.body).toContain('menerima atau menolak');
    // Time is rendered in Asia/Jakarta (WIB): 08:15Z → 15.15 WIB. The
    // Indonesian locale uses `.` as the time separator, not `:` — a
    // stable output across Node LTS versions we care to lock down here.
    expect(c.body).toContain('15.15 WIB');
    expect((c.data as { href?: string }).href).toBe(
      '/me/location-sharing/inbox/req-1',
    );
  });

  it('locationShareResponded outcome map drives copy for supervisor bell', () => {
    const base = {
      requestId: 'req-2',
      targetUserName: 'Budi',
    } as const;
    expect(locationShareResponded({ ...base, outcome: 'RESPONDED' }).body).toContain(
      'mengirim koordinat',
    );
    expect(locationShareResponded({ ...base, outcome: 'DECLINED' }).title).toContain(
      'menolak',
    );
    expect(locationShareResponded({ ...base, outcome: 'EXPIRED' }).body).toContain(
      'hangus otomatis',
    );
    expect(locationShareResponded({ ...base, outcome: 'CANCELLED' }).body).toContain(
      'dibatalkan',
    );
  });

  it('locationShareViewed keeps copy calm + notes the transparency contract', () => {
    const c = locationShareViewed({
      requestId: 'req-3',
      viewerName: 'HR Officer',
      viewerRole: 'HR',
    });
    expect(c.type).toBe('LOCATION_SHARE_VIEWED');
    expect(c.title).toContain('HR Officer');
    expect(c.body).toContain('setiap kali koordinat Anda dilihat');
    expect((c.data as { href?: string }).href).toBe('/me/location-sharing/history');
  });

  it('locationSharingConsentChanged surfaces the action + points to settings', () => {
    const optIn = locationSharingConsentChanged({ action: 'OPT_IN', actorSelf: true });
    expect(optIn.title).toContain('mengaktifkan');
    expect(optIn.body).toContain('mengaktifkan');
    expect((optIn.data as { href?: string }).href).toBe('/settings/privacy');

    const optOut = locationSharingConsentChanged({ action: 'OPT_OUT', actorSelf: true });
    expect(optOut.title).toContain('menonaktifkan');
    expect(optOut.body).toContain('menonaktifkan');
  });

  it('locationShareRequested truncates absurdly long reasons', () => {
    const reason = 'x'.repeat(500);
    const c = locationShareRequested({
      requestId: 'req-4',
      supervisorName: 'Rani',
      reason,
      expiresAt: '2026-08-07T08:15:00.000Z',
    });
    // truncated with a `…` per the shared helper
    expect(c.body).toContain('…');
    expect(c.body.length).toBeLessThan(600);
  });
});
