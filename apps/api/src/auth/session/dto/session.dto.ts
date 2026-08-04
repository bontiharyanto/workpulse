import { ApiProperty } from '@nestjs/swagger';

/**
 * Public wire shape for one active session.
 *
 * We deliberately expose only what is safe for a self-service view:
 * a stable `id` (used to revoke), the transport metadata that lets a
 * user recognise the device (`userAgent`, `ip`), and lifecycle
 * timestamps. The raw `tokenHash` NEVER leaves the DB.
 */
export class SessionDto {
  @ApiProperty({ description: 'Stable RefreshToken.id — used as the revoke path parameter' })
  id!: string;

  @ApiProperty({
    nullable: true,
    description:
      'Best-effort User-Agent string captured at issuance. Truncated to 500 chars by the writer.',
  })
  userAgent!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Best-effort client IP captured at issuance (post proxy trust).',
  })
  ip!: string | null;

  @ApiProperty({
    description:
      'True when this session has cleared the MFA second factor (either at login when MFA was off, OR after `/auth/mfa/verify` step-up).',
  })
  mfaVerified!: boolean;

  @ApiProperty({ description: 'ISO timestamp when the session was created (login).' })
  createdAt!: string;

  @ApiProperty({
    description:
      'ISO timestamp when the refresh token would naturally expire. Callers should still refresh proactively.',
  })
  expiresAt!: string;

  @ApiProperty({
    description:
      'True iff this row backs the caller\'s current refresh cookie. The FE uses it to (a) mark the row and (b) offer a distinct "revoke others" action that skips the current session.',
  })
  isCurrent!: boolean;
}

export class SessionListResponseDto {
  @ApiProperty({ type: [SessionDto] })
  sessions!: SessionDto[];
}

export class SessionRevokeOthersResponseDto {
  @ApiProperty({
    description:
      'Number of sessions that were transitioned from ACTIVE → REVOKED by this call.',
  })
  revokedCount!: number;
}
