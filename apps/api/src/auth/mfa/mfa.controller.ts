import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AllowMfaEnrollmentPending } from '../decorators/allow-mfa-enrollment-pending.decorator';
import { AllowMustChangePassword } from '../decorators/allow-must-change-password.decorator';
import { AllowUnverifiedMfa } from '../decorators/allow-unverified-mfa.decorator';
import {
  MfaBackupCodesResponseDto,
  MfaDisableDto,
  MfaEnrollConfirmResponseDto,
  MfaEnrollStartResponseDto,
  MfaStatusDto,
  MfaTotpCodeDto,
  MfaVerifyDto,
  MfaVerifyResponseDto,
} from './dto/mfa.dto';
import { MfaService } from './mfa.service';

const REFRESH_COOKIE_NAME = 'wp_refresh';

/**
 * All MFA endpoints are mounted under `/auth/mfa` so the `/auth`
 * throttler bucket and the ordering guards in `app.module.ts` apply.
 *
 * Guards & decorators cheat sheet:
 *
 *   enroll/*   → @AllowMfaEnrollmentPending (HR/SA can enroll)
 *   verify     → @AllowUnverifiedMfa (pre-MFA token is exactly the shape
 *                that reaches this route)
 *   backup     → normal auth (must already be MFA-verified)
 *   status     → @AllowMfaEnrollmentPending + @AllowUnverifiedMfa
 *                so FE can read status in any bootstrap phase
 *   disable    → normal auth (must already be MFA-verified)
 *
 * Throttling: enrollment + verification endpoints get stricter buckets
 * than everyday reads because they are targets for online brute force.
 */
@ApiTags('auth')
@Controller({ path: 'auth/mfa', version: '1' })
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly config: ConfigService,
  ) {}

  @Post('enroll/start')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @AllowMfaEnrollmentPending()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOkResponse({ type: MfaEnrollStartResponseDto })
  async enrollStart(@CurrentUser() user: AuthenticatedUser): Promise<MfaEnrollStartResponseDto> {
    return this.mfa.startEnrollment(user.id);
  }

  @Post('enroll/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @AllowMfaEnrollmentPending()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOkResponse({ type: MfaEnrollConfirmResponseDto })
  async enrollConfirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MfaTotpCodeDto,
    @Req() req: Request,
  ): Promise<MfaEnrollConfirmResponseDto> {
    return this.mfa.confirmEnrollment(user.id, dto.code, {
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @AllowUnverifiedMfa()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOkResponse({ type: MfaVerifyResponseDto })
  async verify(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MfaVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MfaVerifyResponseDto> {
    const refreshTokenRaw = extractRefreshCookie(req);
    if (!refreshTokenRaw) {
      // The caller sent a pre-MFA access token but no refresh cookie
      // — either the cookie was cleared, third-party, or someone
      // replayed the header. Refuse rather than issue a step-up token.
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'MFA_MISSING_REFRESH',
        message: 'Sesi login tidak lengkap. Login ulang.',
      });
    }

    const result = await this.mfa.verifyStepUp(
      user.id,
      { code: dto.code, backupCode: dto.backupCode },
      refreshTokenRaw,
      {
        userAgent: req.get('user-agent') ?? undefined,
        ip: req.ip,
      },
    );

    res.cookie(
      REFRESH_COOKIE_NAME,
      result.refreshToken,
      this.buildRefreshCookieOptions(result.refreshTokenExpiresAt),
    );

    return {
      accessToken: result.accessToken,
      accessTokenExpiresIn: result.accessTokenExpiresIn,
      usedBackupCode: result.usedBackupCode,
    };
  }

  @Post('backup-codes/regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOkResponse({ type: MfaBackupCodesResponseDto })
  async regenerateBackupCodes(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MfaTotpCodeDto,
    @Req() req: Request,
  ): Promise<MfaBackupCodesResponseDto> {
    const codes = await this.mfa.regenerateBackupCodes(user.id, dto.code, {
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });
    return { backupCodes: codes };
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async disable(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MfaDisableDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.mfa.disable(user.id, dto.currentPassword, dto.code, {
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });
  }

  @Get('status')
  @ApiBearerAuth()
  @AllowMfaEnrollmentPending()
  @AllowUnverifiedMfa()
  @AllowMustChangePassword()
  @ApiOkResponse({ type: MfaStatusDto })
  async status(@CurrentUser() user: AuthenticatedUser): Promise<MfaStatusDto> {
    const s = await this.mfa.getStatus(user.id);
    return {
      enabled: s.enabled,
      enabledAt: s.enabledAt?.toISOString() ?? null,
      remainingBackupCodes: s.remainingBackupCodes,
    };
  }

  private buildRefreshCookieOptions(expiresAt: Date): CookieOptions {
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/api/v1/auth',
      expires: expiresAt,
    };
  }
}

function extractRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' ? value : undefined;
}
