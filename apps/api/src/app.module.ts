import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';
import { LoggerModule } from 'nestjs-pino';

import { AnalyticsModule } from './analytics/analytics.module';
import { AttachmentModule } from './attachment/attachment.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AttendanceCorrectionModule } from './attendance-correction/attendance-correction.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ConsentAcceptedGuard } from './auth/guards/consent-accepted.guard';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { MfaEnrollmentGuard } from './auth/guards/mfa-enrollment.guard';
import { MfaVerifiedGuard } from './auth/guards/mfa-verified.guard';
import { MustChangePasswordGuard } from './auth/guards/must-change-password.guard';
import { BacklogModule } from './backlog/backlog.module';
import { BreachModule } from './breach/breach.module';
import { RolesGuard } from './common/guards/roles.guard';
import { CompanyModule } from './company/company.module';
import { CompanyAdminModule } from './company-admin/company-admin.module';
import { envValidationSchema } from './config/env.validation';
import { ConsentModule } from './consent/consent.module';
import { DataErasureModule } from './data-erasure/data-erasure.module';
import { DataExportModule } from './data-export/data-export.module';
import { DepartmentModule } from './department/department.module';
import { DpiaModule } from './dpia/dpia.module';
import { GeofenceModule } from './geofence/geofence.module';
import { HealthModule } from './health/health.module';
import { HolidayModule } from './holiday/holiday.module';
import { LeaveModule } from './leave/leave.module';
import { LeaveTypeModule } from './leave-type/leave-type.module';
import { LocationSharingModule } from './location-sharing/location-sharing.module';
import { NotificationModule } from './notification/notification.module';
import { buildLoggerParams } from './observability/logger.config';
import { OvertimeModule } from './overtime/overtime.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportModule } from './report/report.module';
import { ReportsModule } from './reports/reports.module';
import { RetentionModule } from './retention/retention.module';
import { RopaModule } from './ropa/ropa.module';
import { SecurityPolicyModule } from './security-policy/security-policy.module';
import { ShiftModule } from './shift/shift.module';
import { TenantUsageModule } from './tenant-usage/tenant-usage.module';
import { TestSupportModule } from './test-support/test-support.module';
import { TimesheetModule } from './timesheet/timesheet.module';
import { UserAdminModule } from './user/user-admin.module';
import { VendorProcessorModule } from './vendor-processor/vendor-processor.module';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: envValidationSchema.parse,
      envFilePath: ['.env.local', '.env'],
    }),
    // Sentry NestJS integration — no-op when `SENTRY_DSN` is empty because
    // `instrument.ts` skipped `Sentry.init()`. Keeps the module list stable
    // between dev and prod.
    SentryModule.forRoot(),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildLoggerParams(config),
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      // The E2E suite needs to log in as several roles many times within a
      // 60-second window. Rather than punch bespoke holes in every login-
      // shaped endpoint, we let the ops layer flip a single `THROTTLER_DISABLED`
      // flag when running against a private DB (docker-compose, CI, `pnpm e2e`).
      // The flag is NEVER read in production — the env validation refuses
      // `NODE_ENV=production` when this is set (see env.validation.ts).
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60_000,
            limit: 120,
          },
        ],
        skipIf: () => config.get<string>('THROTTLER_DISABLED') === 'true',
      }),
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    AttendanceModule,
    AttendanceCorrectionModule,
    AttachmentModule,
    AuditModule,
    BacklogModule,
    LeaveModule,
    OvertimeModule,
    CompanyModule,
    CompanyAdminModule,
    DepartmentModule,
    UserAdminModule,
    GeofenceModule,
    ShiftModule,
    LeaveTypeModule,
    HolidayModule,
    ReportModule,
    NotificationModule,
    LocationSharingModule,
    DataExportModule,
    DataErasureModule,
    RetentionModule,
    ConsentModule,
    RopaModule,
    SecurityPolicyModule,
    DpiaModule,
    ReportsModule,
    BreachModule,
    TimesheetModule,
    WebhookModule,
    AnalyticsModule,
    TenantUsageModule,
    VendorProcessorModule,
    TestSupportModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Order matters — each of these guards needs `req.user` populated
    // by `JwtAuthGuard` above, and must reject BEFORE `RolesGuard` so
    // that a caller stuck in a bootstrap flow (temp password → change
    // it; MFA required → verify; MFA enrollment required → enroll;
    // consent pending → accept) is told which flow to walk before we
    // tell them they're the wrong role for the endpoint. Order within
    // the block encodes priority:
    //   password rotation > MFA step-up > MFA enrollment > consent >
    //   role.
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
    { provide: APP_GUARD, useClass: MfaVerifiedGuard },
    { provide: APP_GUARD, useClass: MfaEnrollmentGuard },
    { provide: APP_GUARD, useClass: ConsentAcceptedGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
