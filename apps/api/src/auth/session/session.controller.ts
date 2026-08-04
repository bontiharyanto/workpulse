import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

import {
  SessionDto,
  SessionListResponseDto,
  SessionRevokeOthersResponseDto,
} from './dto/session.dto';
import { SessionService, type SessionSummary } from './session.service';

const REFRESH_COOKIE_NAME = 'wp_refresh';

/**
 * Fase 30b — self-service session management.
 *
 * Every route is scoped strictly to the caller (`user.id`). Cross-user
 * revocation is not exposed here; admin revocation of a user's
 * sessions happens through `UserAdminService.resetPassword` /
 * `deactivate`, which already emits its own audit log.
 *
 * Design notes:
 *
 * - **Refresh cookie is the "current-session" fingerprint.** Every
 *   response marks exactly one row as `isCurrent=true` (the row whose
 *   `tokenHash` matches SHA-256 of the cookie the caller sent). Missing
 *   cookie → no row is marked; FE handles that gracefully.
 * - **Revoking your OWN current session** is allowed and audited — a
 *   user might want to sign out this specific device from another
 *   device. The next `/auth/refresh` will fail and the FE bounces to
 *   `/login`.
 * - **`POST /revoke-others`** revokes every session EXCEPT the current
 *   one. If the caller has no cookie (some cURL-based clients), it
 *   degenerates into "revoke everything" — same effect as
 *   `POST /auth/logout-all`, but with a different audit action so
 *   security audits can distinguish user intent.
 */
@ApiTags('sessions')
@Controller({ path: 'auth/sessions', version: '1' })
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOkResponse({ type: SessionListResponseDto })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SessionListResponseDto> {
    const raw = extractRefreshCookie(req);
    const sessions = await this.sessions.list(user.id, raw);
    return { sessions: sessions.map(toDto) };
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiNoContentResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') sessionId: string,
  ): Promise<void> {
    await this.sessions.revoke(user.id, sessionId);
  }

  @Post('revoke-others')
  @ApiBearerAuth()
  @ApiOkResponse({ type: SessionRevokeOthersResponseDto })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async revokeOthers(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SessionRevokeOthersResponseDto> {
    const raw = extractRefreshCookie(req);
    return this.sessions.revokeOthers(user.id, raw);
  }
}

function extractRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' ? value : undefined;
}

function toDto(s: SessionSummary): SessionDto {
  return {
    id: s.id,
    userAgent: s.userAgent,
    ip: s.ip,
    mfaVerified: s.mfaVerified,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    isCurrent: s.isCurrent,
  };
}
