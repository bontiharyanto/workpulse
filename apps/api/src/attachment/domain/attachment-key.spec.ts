import { buildAttachmentKey, isOwnedAttachmentKey } from './attachment-key';

const UUID = '3f9c1234-abcd-4ef0-9876-fedcba987654';

describe('buildAttachmentKey', () => {
  it('composes the canonical path with UTC year/month', () => {
    const key = buildAttachmentKey({
      purpose: 'leave-attachment',
      companyId: 'co-1',
      userId: 'u-1',
      extension: 'pdf',
      uuid: UUID,
      now: new Date('2026-03-04T10:00:00Z'),
    });
    expect(key).toBe(`attachments/leave-attachment/co-1/u-1/2026/03/${UUID}.pdf`);
  });

  it('rejects a slash in companyId/userId (path traversal)', () => {
    expect(() =>
      buildAttachmentKey({
        purpose: 'leave-attachment',
        companyId: 'co-1/../other',
        userId: 'u-1',
        extension: 'pdf',
        uuid: UUID,
        now: new Date(),
      }),
    ).toThrow(RangeError);
  });

  it('rejects a bogus extension', () => {
    expect(() =>
      buildAttachmentKey({
        purpose: 'leave-attachment',
        companyId: 'co-1',
        userId: 'u-1',
        extension: 'PDF!',
        uuid: UUID,
        now: new Date(),
      }),
    ).toThrow(RangeError);
  });

  it('rejects a malformed UUID', () => {
    expect(() =>
      buildAttachmentKey({
        purpose: 'leave-attachment',
        companyId: 'co-1',
        userId: 'u-1',
        extension: 'pdf',
        uuid: 'not-a-uuid',
        now: new Date(),
      }),
    ).toThrow(RangeError);
  });
});

describe('isOwnedAttachmentKey', () => {
  const key = `attachments/leave-attachment/co-1/u-1/2026/03/${UUID}.pdf`;

  it('accepts a well-formed, correctly-owned key', () => {
    expect(isOwnedAttachmentKey(key, 'co-1', 'u-1')).toBe(true);
  });

  it('rejects a key belonging to another user', () => {
    expect(isOwnedAttachmentKey(key, 'co-1', 'u-2')).toBe(false);
  });

  it('rejects a key belonging to another company', () => {
    expect(isOwnedAttachmentKey(key, 'co-2', 'u-1')).toBe(false);
  });

  it('rejects path traversal / whitespace attempts', () => {
    expect(
      isOwnedAttachmentKey(
        `attachments/leave-attachment/co-1/u-1/../../etc/passwd`,
        'co-1',
        'u-1',
      ),
    ).toBe(false);
    expect(
      isOwnedAttachmentKey(`attachments/leave-attachment/co-1/u-1/2026/03/${UUID} .pdf`, 'co-1', 'u-1'),
    ).toBe(false);
  });

  it('rejects an unknown purpose', () => {
    expect(
      isOwnedAttachmentKey(
        `attachments/other-purpose/co-1/u-1/2026/03/${UUID}.pdf`,
        'co-1',
        'u-1',
      ),
    ).toBe(false);
  });

  it('rejects extension outside the allowed shape', () => {
    expect(
      isOwnedAttachmentKey(
        `attachments/leave-attachment/co-1/u-1/2026/03/${UUID}.executable`,
        'co-1',
        'u-1',
      ),
    ).toBe(false);
  });

  it('accepts an attendance-correction key when the caller opts into that purpose', () => {
    const correctionKey = `attachments/attendance-correction/co-1/u-1/2026/08/${UUID}.jpg`;
    expect(
      isOwnedAttachmentKey(correctionKey, 'co-1', 'u-1', 'attendance-correction'),
    ).toBe(true);
    // The default purpose (leave-attachment) rejects it — the same key
    // cannot be silently reused across modules.
    expect(isOwnedAttachmentKey(correctionKey, 'co-1', 'u-1')).toBe(false);
  });
});
