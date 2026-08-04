import { ApiProperty } from '@nestjs/swagger';

import type { UserRole } from '../../common/types/user-role';

export class AuthenticatedUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() companyId!: string;
  @ApiProperty({ nullable: true }) departmentId!: string | null;
  @ApiProperty({ enum: ['EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN'] })
  role!: UserRole;
  @ApiProperty({
    description:
      'When true, the client MUST redirect the user to the change-password flow before any other API call will succeed.',
  })
  mustChangePassword!: boolean;
  @ApiProperty({
    description:
      'When true, the user has enrolled a TOTP second factor. Combined with `mfaPassed=false` this indicates the current session still needs to complete `/auth/mfa/verify`.',
  })
  mfaEnabled!: boolean;
  @ApiProperty({
    description:
      'False iff the access token backing this response is pre-MFA (mid-login step-up pending). All non `/auth/mfa/*` and non `@AllowUnverifiedMfa` routes will 403.',
  })
  mfaPassed!: boolean;
  @ApiProperty({
    description:
      'True when the caller is high-privilege (HR_MANAGER, SUPER_ADMIN), has not yet enrolled MFA, AND the server-side enforcement flag `MFA_ENFORCE_HR_ADMIN` is on. The FE MUST redirect to `/setup-mfa` in that case — otherwise every subsequent API request will 403 with `MFA_ENROLLMENT_REQUIRED`. Read this instead of computing role + mfaEnabled on the FE, so a `false` env override (test-only) also disables the client redirect.',
  })
  mfaEnrollmentRequired!: boolean;

  @ApiProperty({
    nullable: true,
    description:
      'Non-null when the caller has NOT accepted the tenant\'s currently-active privacy policy. The FE MUST redirect to `/consent` and POST `/me/consent` before any non-`/auth/*`, non-`/me/consent/*` endpoint will accept the caller. Null if there is no active policy OR the user already accepted it.',
  })
  pendingConsent!: PendingConsentDto | null;
}

export class PendingConsentDto {
  @ApiProperty() id!: string;
  @ApiProperty() version!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty() effectiveAt!: string;
}

export class LoginResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ description: 'Access token lifetime in seconds' })
  accessTokenExpiresIn!: number;
  @ApiProperty({ type: AuthenticatedUserDto }) user!: AuthenticatedUserDto;
  @ApiProperty({
    description:
      'When true the caller MUST POST `/auth/mfa/verify` with a TOTP or backup code before any other API call will succeed. The refresh cookie has already been set.',
  })
  mfaRequired!: boolean;
}

export class RefreshResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() accessTokenExpiresIn!: number;
}
