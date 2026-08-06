import {
  Body,
  Controller,
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

import { AuthService } from './auth.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { ConsentService } from '../consent/consent.service';
import { SecurityPolicyService } from '../security-policy/security-policy.service';
import { AllowMustChangePassword } from './decorators/allow-must-change-password.decorator';
import { AllowPendingConsent } from './decorators/allow-pending-consent.decorator';
import { Public } from './decorators/public.decorator';
import {
  AuthenticatedUserDto,
  LoginResponseDto,
  RefreshResponseDto,
} from './dto/auth-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordResetService } from './password-reset.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

const REFRESH_COOKIE_NAME = 'wp_refresh';

/**
 * Roles that the backend `MfaEnrollmentGuard` forces to enroll MFA
 * before any non-`/auth/*` request will succeed. Kept in sync with
 * that guard's own `MANDATORY_ROLES` — the source of truth for the
 * policy is the guard; the controller only mirrors it into the wire
 * response so the FE can pre-empt the 403.
 */
const MFA_MANDATORY_ROLES = new Set(['HR_MANAGER', 'SUPER_ADMIN']);

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly passwordReset: PasswordResetService,
    private readonly consent: ConsentService,
    // Read the caller's tenant policy so `mfaEnrollmentRequired`
    // reflects the runtime toggle (see `SecurityPolicyService`) —
    // not a boot-time env read that would go stale on flip.
    private readonly securityPolicy: SecurityPolicyService,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOkResponse({ type: LoginResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const { user, tokens, mfaRequired } = await this.auth.login(
      { email: dto.email, password: dto.password },
      {
        userAgent: req.get('user-agent') ?? undefined,
        ip: req.ip,
      },
    );

    res.cookie(
      REFRESH_COOKIE_NAME,
      tokens.refreshToken,
      this.buildRefreshCookieOptions(tokens.refreshTokenExpiresAt),
    );

    return {
      accessToken: tokens.accessToken,
      accessTokenExpiresIn: tokens.accessTokenExpiresIn,
      user: await this.toDto(user),
      mfaRequired,
    };
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOkResponse({ type: RefreshResponseDto })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponseDto> {
    const raw = extractRefreshCookie(req);
    if (!raw) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    const pair = await this.auth.refresh(raw, {
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });

    res.cookie(
      REFRESH_COOKIE_NAME,
      pair.refreshToken,
      this.buildRefreshCookieOptions(pair.refreshTokenExpiresAt),
    );

    return {
      accessToken: pair.accessToken,
      accessTokenExpiresIn: pair.accessTokenExpiresIn,
    };
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const raw = extractRefreshCookie(req);
    await this.auth.logout(raw);
    res.clearCookie(REFRESH_COOKIE_NAME, this.buildRefreshCookieOptions(new Date(0)));
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @AllowMustChangePassword()
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logoutAllDevices(user.id);
    res.clearCookie(REFRESH_COOKIE_NAME, this.buildRefreshCookieOptions(new Date(0)));
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({ type: AuthenticatedUserDto })
  @AllowMustChangePassword()
  @AllowPendingConsent()
  me(@CurrentUser() user: AuthenticatedUser): Promise<AuthenticatedUserDto> {
    return this.toDto(user);
  }

  /**
   * Self-service password change. Also the escape hatch for accounts flagged
   * `mustChangePassword` — the guard whitelists this route via
   * `@AllowMustChangePassword()`. On success, every refresh token is revoked
   * (this device included) so the FE must return to `/login`.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @AllowMustChangePassword()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    await this.auth.changePassword(
      {
        userId: user.id,
        currentPassword: dto.currentPassword,
        newPassword: dto.newPassword,
      },
      {
        userAgent: req.get('user-agent') ?? undefined,
        ip: req.ip,
      },
    );
    res.clearCookie(REFRESH_COOKIE_NAME, this.buildRefreshCookieOptions(new Date(0)));
    return {
      message: 'Password Anda telah berhasil diubah. Silakan login menggunakan password baru.',
    };
  }

  /**
   * Request a password-reset email. Always returns 202 with a generic
   * body — the response is IDENTICAL whether or not the email is on
   * file, so the caller can't enumerate accounts. Rate-limited
   * aggressively per IP because it's an unauthenticated write.
   */
  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.passwordReset.requestReset({
      email: dto.email,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
    return {
      message:
        'Jika email tersebut terdaftar, kami telah mengirimkan link reset password. Silakan cek inbox Anda.',
    };
  }

  /**
   * Consume a reset token and set a new password. On success, ALL
   * active refresh tokens for the user are revoked so every device
   * that was logged in with the old password must reauthenticate.
   *
   * Returns a generic `INVALID_TOKEN` for any failure — never say
   * "expired" or "used" separately, or an attacker can distinguish
   * "token issued but stale" from "token never existed" and probe.
   */
  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    await this.passwordReset.resetPassword({
      rawToken: dto.token,
      newPassword: dto.password,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
    // Because we revoked every refresh token, also clear any cookie the
    // browser is holding onto — otherwise a stale session in this same
    // browser would linger until the next `/auth/refresh` failure.
    res.clearCookie(REFRESH_COOKIE_NAME, this.buildRefreshCookieOptions(new Date(0)));
    return {
      message: 'Password Anda telah berhasil diubah. Silakan login menggunakan password baru.',
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

  /**
   * Coerces the (optional) claim fields on the runtime user shape into
   * the strict booleans the wire DTO promises. Legacy JWTs that predate
   * a field flow through as `false` — safe direction: we NEVER lock a
   * user out because of a missing claim. Also stamps
   * `mfaEnrollmentRequired` so the FE can mirror the backend's
   * `MfaEnrollmentGuard` without duplicating its policy read.
   */
  private async toDto(user: AuthenticatedUser): Promise<AuthenticatedUserDto> {
    // `pendingConsent` is only interesting when the session is otherwise
    // usable — a user still stuck on mustChangePassword or pre-MFA has a
    // higher-priority redirect already, so we don't waste the DB read.
    const shouldCheckConsent = user.mustChangePassword !== true && user.mfaPassed !== false;
    const pendingConsent = shouldCheckConsent
      ? await this.consent.getPendingConsentForUser(user.id, user.companyId)
      : null;

    // Mirror `MfaEnrollmentGuard`'s per-tenant decision so the FE
    // redirect matches the backend 403 exactly. The lookup is a
    // cached read (see `SecurityPolicyService`).
    let mfaEnrollmentRequired = false;
    if (MFA_MANDATORY_ROLES.has(user.role) && user.mfaEnabled !== true) {
      const policy = await this.securityPolicy.getForCompany(user.companyId);
      mfaEnrollmentRequired = policy.mfaEnforceHighPrivileged;
    }

    return {
      id: user.id,
      email: user.email,
      companyId: user.companyId,
      departmentId: user.departmentId,
      role: user.role,
      mustChangePassword: user.mustChangePassword === true,
      mfaEnabled: user.mfaEnabled === true,
      mfaPassed: user.mfaPassed !== false,
      mfaEnrollmentRequired,
      pendingConsent: pendingConsent
        ? {
            id: pendingConsent.id,
            version: pendingConsent.version,
            title: pendingConsent.title,
            body: pendingConsent.body,
            effectiveAt: pendingConsent.effectiveAt.toISOString(),
          }
        : null,
    };
  }
}

function extractRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' ? value : undefined;
}
