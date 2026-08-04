import {
  summarizeLeave,
  toLeaveSummaryRows,
  type LeaveSummaryRawLeaveType,
  type LeaveSummaryRawUser,
} from './leave-summary-report';

const annual: LeaveSummaryRawLeaveType = { id: 'lt-annual', code: 'ANNUAL', name: 'Annual' };
const sick: LeaveSummaryRawLeaveType = { id: 'lt-sick', code: 'SICK', name: 'Sick' };

describe('toLeaveSummaryRows', () => {
  it('emits one row per (user × leaveType), zero-filled when missing', () => {
    const users: LeaveSummaryRawUser[] = [
      {
        id: 'u1',
        fullName: 'Alice',
        email: 'a@x.test',
        department: { name: 'Eng' },
        balances: [
          {
            leaveTypeId: 'lt-annual',
            year: 2026,
            quota: 12,
            carriedOver: 2,
            used: 3,
            reserved: 1,
            remaining: 10,
          },
        ],
      },
      {
        id: 'u2',
        fullName: 'Bob',
        email: 'b@x.test',
        department: null,
        balances: [],
      },
    ];

    const rows = toLeaveSummaryRows(users, [annual, sick], 2026);
    expect(rows).toHaveLength(4);
    // Alice — Annual
    expect(rows[0]).toMatchObject({
      userFullName: 'Alice',
      leaveTypeCode: 'ANNUAL',
      quota: 12,
      carriedOver: 2,
      used: 3,
      reserved: 1,
      remaining: 10,
    });
    // Alice — Sick (missing balance)
    expect(rows[1]).toMatchObject({
      userFullName: 'Alice',
      leaveTypeCode: 'SICK',
      quota: 0,
      remaining: 0,
    });
    // Bob — Annual (missing balance)
    expect(rows[2]).toMatchObject({
      userFullName: 'Bob',
      departmentName: '—',
      leaveTypeCode: 'ANNUAL',
      quota: 0,
    });
  });

  it('ignores balances from a different year', () => {
    const rows = toLeaveSummaryRows(
      [
        {
          id: 'u1',
          fullName: 'A',
          email: 'a@x.test',
          department: null,
          balances: [
            {
              leaveTypeId: 'lt-annual',
              year: 2025,
              quota: 12,
              carriedOver: 0,
              used: 0,
              reserved: 0,
              remaining: 12,
            },
          ],
        },
      ],
      [annual],
      2026,
    );
    expect(rows[0]?.quota).toBe(0);
  });
});

describe('summarizeLeave', () => {
  it('aggregates totals and counts distinct users/types', () => {
    const rows = toLeaveSummaryRows(
      [
        {
          id: 'u1',
          fullName: 'A',
          email: 'a@x.test',
          department: null,
          balances: [
            {
              leaveTypeId: 'lt-annual',
              year: 2026,
              quota: 12,
              carriedOver: 2,
              used: 3,
              reserved: 1,
              remaining: 10,
            },
          ],
        },
      ],
      [annual, sick],
      2026,
    );
    expect(summarizeLeave(rows)).toEqual({
      users: 1,
      leaveTypes: 2,
      totalQuota: 14, // 12+2 (annual) + 0 (sick)
      totalUsed: 3,
      totalReserved: 1,
      totalRemaining: 10,
    });
  });
});
