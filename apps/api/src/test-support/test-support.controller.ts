import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AnalyticsSnapshotService } from '../analytics/analytics-snapshot.service';
import { AnalyticsSnapshotWorker } from '../analytics/analytics-snapshot.worker';
import { ReportSchedulerWorker } from '../reports/report-scheduler.worker';
import { asYmd } from '../analytics/domain/period';
import { Public } from '../auth/decorators/public.decorator';
import { DataErasureWorker } from '../data-erasure/data-erasure.worker';
import { PrismaService } from '../prisma/prisma.service';
import { RetentionWorker } from '../retention/retention.worker';
import { TimesheetSchedulerWorker } from '../timesheet/timesheet-scheduler.worker';
import { TimesheetService } from '../timesheet/timesheet.service';
import { WebhookWorker } from '../webhook/webhook.worker';

/**
 * Escape hatches for E2E tests. Every route on this controller is a
 * no-op unless `THROTTLER_DISABLED=true` — the same env flag that
 * `env.validation.ts` refuses in production. That single gate is the
 * only thing standing between production traffic and destructive
 * test helpers, so PLEASE do not remove it.
 *
 * We intentionally do NOT protect these routes with JWT auth: they
 * exist to reset state between login attempts, and a broken auth
 * state should still let the test framework recover.
 */
@Controller({ path: 'test-support', version: '1' })
export class TestSupportController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    private readonly erasureWorker: DataErasureWorker,
    private readonly retentionWorker: RetentionWorker,
    private readonly timesheetService: TimesheetService,
    private readonly webhookWorker: WebhookWorker,
    private readonly timesheetScheduler: TimesheetSchedulerWorker,
    private readonly analyticsWorker: AnalyticsSnapshotWorker,
    private readonly analyticsSnapshot: AnalyticsSnapshotService,
    private readonly reportScheduler: ReportSchedulerWorker,
  ) {}

  /**
   * Fase 33c — trigger a scheduler tick synchronously. Optionally
   * pass `at` to override "now" so the caller can create a schedule
   * with `nextRunAt` in the past and immediately dispatch it.
   */
  @Post('report-scheduler/tick')
  @HttpCode(HttpStatus.OK)
  @Public()
  async reportSchedulerTick(@Body() body: { at?: string } = {}): Promise<{ delivered: number }> {
    this.assertEnabled();
    const now = body.at ? new Date(body.at) : new Date();
    if (Number.isNaN(now.getTime())) {
      throw new ForbiddenException('invalid `at` timestamp');
    }
    const delivered = await this.reportScheduler.tickForTest(now);
    return { delivered };
  }

  @Post('data-export/prune')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async pruneDataExports(@Body() body: { email: string }): Promise<void> {
    this.assertEnabled();
    if (!body.email) return;
    const user = await this.prisma.user.findFirst({
      where: { email: body.email },
      select: { id: true },
    });
    if (!user) return;
    await this.prisma.dataExportRequest.deleteMany({
      where: { userId: user.id },
    });
  }

  @Post('data-erasure/prune')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async pruneDataErasures(@Body() body: { email: string }): Promise<void> {
    this.assertEnabled();
    if (!body.email) return;
    const user = await this.prisma.user.findFirst({
      where: { email: body.email },
      select: { id: true },
    });
    if (!user) return;
    // Erasure rows themselves are safe to nuke in a test bench —
    // they carry no dependent FKs beyond the audit log (which lives
    // in its own append-only table and is orthogonal to the row).
    await this.prisma.dataErasureRequest.deleteMany({
      where: { userId: user.id },
    });
  }

  /**
   * Advance an APPROVED_SCHEDULED erasure row's `scheduledFor` into
   * the past so the worker will pick it up on the next tick. Lets
   * E2E tests exercise the full lifecycle without waiting the
   * configured grace period. NEVER exposed in production; the
   * `assertEnabled` gate ensures that.
   */
  @Post('data-erasure/fast-forward')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async fastForwardErasure(@Body() body: { id: string }): Promise<void> {
    this.assertEnabled();
    if (!body.id) return;
    await this.prisma.dataErasureRequest.updateMany({
      where: { id: body.id, status: 'APPROVED_SCHEDULED' },
      data: { scheduledFor: new Date(Date.now() - 60_000) },
    });
  }

  /**
   * Kick the erasure worker's `tick()` immediately instead of
   * waiting for the 5-minute cron. Only used by E2E to make the
   * full lifecycle test complete in seconds.
   */
  @Post('data-erasure/tick')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async tickErasureWorker(): Promise<void> {
    this.assertEnabled();
    await this.erasureWorker.tick();
  }

  /**
   * Create a throwaway user in the same company/department as
   * `sourceEmail`, reusing its password hash so the caller can
   * log in with the same seed password. Returned only for the
   * duration of a test — never persisted in shared fixtures.
   *
   * Purpose: destructive tests (erasure lifecycle) can anonymise
   * this user without corrupting the shared seed users.
   */
  @Post('user/create-throwaway')
  @Public()
  async createThrowawayUser(
    @Body() body: { sourceEmail: string },
  ): Promise<{ id: string; email: string }> {
    this.assertEnabled();
    const source = await this.prisma.user.findFirst({
      where: { email: body.sourceEmail, deletedAt: null },
    });
    if (!source) {
      throw new ForbiddenException(`test-support: source user ${body.sourceEmail} not found`);
    }
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const email = `throwaway-${suffix}@workpulse.test`;
    const user = await this.prisma.user.create({
      data: {
        companyId: source.companyId,
        departmentId: source.departmentId,
        email,
        // Reuse the source's argon2 hash so tests can log in with the
        // same seed password without needing to know the hash.
        passwordHash: source.passwordHash,
        fullName: `Throwaway ${suffix}`,
        role: 'EMPLOYEE',
        employmentStatus: 'ACTIVE',
        hiredAt: new Date(),
        supervisorId: source.supervisorId,
        timezone: source.timezone,
      },
      select: { id: true, email: true },
    });
    return user;
  }

  /**
   * Kick the retention worker immediately, bypassing the daily cron.
   * E2E-only: lets us assert the effect of a retention-policy change
   * without waiting until 02:00 UTC.
   */
  @Post('retention/tick')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async tickRetentionWorker(): Promise<void> {
    this.assertEnabled();
    await this.retentionWorker.runOnce();
  }

  /**
   * Reset a tenant's `RetentionPolicy` to fallback defaults + delete
   * every notification older than a specific age so the retention
   * E2E gets a deterministic starting point.
   */
  @Post('retention/prime')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async primeRetention(@Body() body: { companyId?: string; email?: string }): Promise<void> {
    this.assertEnabled();
    const companyId = await this.resolveCompanyId(body);
    if (!companyId) return;
    // Wipe any admin-authored retention config so the test starts
    // from the schema defaults.
    await this.prisma.retentionPolicy.deleteMany({ where: { companyId } });
  }

  /**
   * Age every notification in a tenant by `ageDays` so a retention
   * sweep can prune them. Pure convenience — the alternative would
   * be waiting real wall-clock days.
   */
  @Post('retention/age-notifications')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async ageNotifications(
    @Body()
    body: {
      companyId?: string;
      email?: string;
      ageDays: number;
    },
  ): Promise<void> {
    this.assertEnabled();
    const companyId = await this.resolveCompanyId(body);
    if (!companyId) return;
    const cutoff = new Date(Date.now() - body.ageDays * 86_400_000);
    await this.prisma.notification.updateMany({
      where: { companyId },
      data: { createdAt: cutoff },
    });
  }

  /**
   * Wipe every privacy-policy row + user-consent row for a tenant so
   * the consent E2E can start from a blank slate.
   */
  @Post('consent/prune')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async pruneConsent(@Body() body: { companyId?: string; email?: string }): Promise<void> {
    this.assertEnabled();
    const companyId = await this.resolveCompanyId(body);
    if (!companyId) return;
    // Delete order — consents reference policies via RESTRICT.
    await this.prisma.userConsent.deleteMany({ where: { companyId } });
    await this.prisma.privacyPolicy.deleteMany({ where: { companyId } });
  }

  /**
   * Wipe every timesheet + period + config for a tenant so the
   * timesheet E2E can start from a blank slate.
   */
  @Post('timesheet/prune')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async pruneTimesheets(@Body() body: { companyId?: string; email?: string }): Promise<void> {
    this.assertEnabled();
    const companyId = await this.resolveCompanyId(body);
    if (!companyId) return;
    // Entries cascade with Timesheet.deleteMany because of the FK.
    await this.prisma.timesheet.deleteMany({ where: { companyId } });
    await this.prisma.timesheetPeriod.deleteMany({ where: { companyId } });
    await this.prisma.timesheetConfig.deleteMany({ where: { companyId } });
  }

  /**
   * Force-generate the current-period timesheet for a tenant. Wraps
   * `TimesheetService.generateForPeriod(companyId, at)` so tests can
   * simulate an HR "Generate" click without hitting the throttled
   * admin endpoint (and without needing an HR JWT).
   */
  @Post('timesheet/generate')
  @HttpCode(HttpStatus.OK)
  @Public()
  async generateTimesheet(
    @Body() body: { companyId?: string; email?: string; at?: string },
  ): Promise<{ periodId: string; timesheetsGenerated: number } | null> {
    this.assertEnabled();
    const companyId = await this.resolveCompanyId(body);
    if (!companyId) return null;
    const at = body.at ? new Date(body.at) : new Date();
    return this.timesheetService.generateForPeriod(companyId, at);
  }

  /**
   * Force-approve every timesheet in a period so an export test can
   * skip the two-tier workflow entirely (Fase 32c). Wraps the raw
   * update inside the same tenant filter the service uses.
   */
  @Post('timesheet/approve-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async approveAllTimesheets(@Body() body: { email: string; periodId: string }): Promise<void> {
    this.assertEnabled();
    const companyId = await this.resolveCompanyId(body);
    if (!companyId) return;
    await this.prisma.timesheet.updateMany({
      where: { companyId, periodId: body.periodId },
      data: {
        status: 'APPROVED',
        submittedAt: new Date(),
        supervisorAt: new Date(),
        hrManagerAt: new Date(),
      },
    });
  }

  /**
   * Purge past export audit rows so a re-run of the export E2E starts
   * from a clean slate.
   */
  @Post('timesheet-export/prune')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async pruneTimesheetExports(@Body() body: { email: string }): Promise<void> {
    this.assertEnabled();
    const companyId = await this.resolveCompanyId(body);
    if (!companyId) return;
    // TimesheetExport has REVOKE UPDATE, DELETE on prod but the test
    // bench runs the migration under a superuser that keeps DELETE.
    await this.prisma.timesheetExport.deleteMany({ where: { companyId } });
  }

  /**
   * Fase 32e — force the webhook worker to run a tick immediately so
   * an E2E spec doesn't need to sleep 30 seconds for the next cron.
   * Unlike the cron path, this is synchronous with the request.
   */
  @Post('webhook/deliver-now')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async webhookDeliverNow(): Promise<void> {
    this.assertEnabled();
    await this.webhookWorker.tickForTest();
  }

  /**
   * Purge webhook endpoints + deliveries for a tenant so E2E can start
   * from a clean slate.
   */
  @Post('webhook/prune')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async pruneWebhooks(@Body() body: { email: string }): Promise<void> {
    this.assertEnabled();
    const companyId = await this.resolveCompanyId(body);
    if (!companyId) return;
    // deliveries cascade with endpoints, but nuke explicitly so no
    // orphans linger if a foreign-key change lands later.
    await this.prisma.webhookDelivery.deleteMany({ where: { companyId } });
    await this.prisma.webhookEndpoint.deleteMany({ where: { companyId } });
  }

  /**
   * Fase 32f — force the timesheet scheduler to sweep once, with an
   * optional simulated `now` so tests can pretend today is N days
   * after periodEnd without waiting a real day. Returns the reports
   * so the E2E can assert `submitRemindersSent > 0` etc.
   */
  @Post('timesheet-scheduler/tick')
  @HttpCode(HttpStatus.OK)
  @Public()
  async timesheetSchedulerTick(@Body() body: { at?: string } = {}): Promise<{
    reports: Awaited<ReturnType<TimesheetSchedulerWorker['tickForTest']>>;
  }> {
    this.assertEnabled();
    const now = body.at ? new Date(body.at) : new Date();
    if (Number.isNaN(now.getTime())) {
      throw new ForbiddenException('invalid `at` timestamp');
    }
    const reports = await this.timesheetScheduler.tickForTest(now);
    return { reports };
  }

  /**
   * Wipe the reminder log for a tenant so a re-run of the tick sends
   * reminders again on the same calendar day. Companion to
   * `timesheet-scheduler/tick`.
   */
  @Post('timesheet-scheduler/prune')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async pruneTimesheetReminders(
    @Body() body: { email?: string; companyId?: string },
  ): Promise<void> {
    this.assertEnabled();
    const companyId = await this.resolveCompanyId(body);
    if (!companyId) return;
    await this.prisma.timesheetReminderLog.deleteMany({
      where: { companyId },
    });
  }

  /**
   * Wipe every notification for a tenant so assertion-driven E2E
   * specs (e.g. "the user just got a TIMESHEET_SUBMIT_REMINDER")
   * don't have to filter through history.
   */
  @Post('notifications/prune')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async pruneNotifications(@Body() body: { email?: string; companyId?: string }): Promise<void> {
    this.assertEnabled();
    const companyId = await this.resolveCompanyId(body);
    if (!companyId) return;
    await this.prisma.notification.deleteMany({ where: { companyId } });
  }

  /**
   * Force a specific timesheet into a specific status (with matching
   * bookkeeping timestamps) so the reminder tick has something to
   * chew on without running the full submit/approve UI. Used by the
   * scheduler E2E — DO NOT surface this to real users under any
   * circumstance.
   */
  @Post('timesheet/force-status')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async forceTimesheetStatus(
    @Body()
    body: {
      timesheetId: string;
      status: 'DRAFT' | 'PENDING_SUPERVISOR' | 'PENDING_HR' | 'APPROVED' | 'REJECTED';
    },
  ): Promise<void> {
    this.assertEnabled();
    await this.prisma.timesheet.update({
      where: { id: body.timesheetId },
      data: {
        status: body.status,
        submittedAt: body.status === 'DRAFT' ? null : new Date(),
      },
    });
  }

  /**
   * Shift a period's `(periodStart, periodEnd)` into the past by a
   * fixed number of days. The scheduler treats "days since
   * periodEnd" as the trigger, so this lets the E2E pretend a period
   * closed N days ago without waiting real time. Companion helper
   * for the reminder-fire E2E.
   */
  @Post('timesheet/backdate-period')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async backdateTimesheetPeriod(
    @Body() body: { periodId: string; daysBack: number },
  ): Promise<void> {
    this.assertEnabled();
    const period = await this.prisma.timesheetPeriod.findUniqueOrThrow({
      where: { id: body.periodId },
    });
    const shiftMs = body.daysBack * 86_400_000;
    await this.prisma.timesheetPeriod.update({
      where: { id: body.periodId },
      data: {
        periodStart: new Date(period.periodStart.getTime() - shiftMs),
        periodEnd: new Date(period.periodEnd.getTime() - shiftMs),
      },
    });
  }

  /**
   * Fase 33a — trigger the executive-KPI snapshot worker synchronously.
   * `at` is optional; when omitted uses the current wall clock. Returns
   * the worker's summary so tests can assert both counts.
   */
  @Post('analytics/tick')
  @HttpCode(HttpStatus.OK)
  @Public()
  async analyticsTick(
    @Body() body: { at?: string } = {},
  ): Promise<{ tenantsProcessed: number; tenantsFailed: number }> {
    this.assertEnabled();
    const now = body.at ? new Date(body.at) : new Date();
    if (Number.isNaN(now.getTime())) {
      throw new ForbiddenException('invalid `at` timestamp');
    }
    return this.analyticsWorker.tickForTest(now);
  }

  /**
   * Backfill a single tenant across a Y-M-D range. Used by the
   * dashboard E2E to materialise a deterministic 30-day surface
   * without waiting on 30 real cron ticks.
   */
  @Post('analytics/backfill')
  @HttpCode(HttpStatus.OK)
  @Public()
  async analyticsBackfill(
    @Body()
    body: {
      companyId?: string;
      email?: string;
      from: string;
      to: string;
    },
  ): Promise<{ daysProcessed: number } | null> {
    this.assertEnabled();
    const companyId = await this.resolveCompanyId(body);
    if (!companyId) return null;
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { timezone: true },
    });
    if (!company) return null;
    return this.analyticsSnapshot.backfill(
      companyId,
      asYmd(body.from),
      asYmd(body.to),
      company.timezone,
    );
  }

  /**
   * Wipe every snapshot row for a tenant so the E2E starts from a
   * blank slate. Companion to `analytics/tick`.
   */
  @Post('analytics/prune')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async pruneAnalytics(@Body() body: { companyId?: string; email?: string }): Promise<void> {
    this.assertEnabled();
    const companyId = await this.resolveCompanyId(body);
    if (!companyId) return;
    await this.prisma.analyticsSnapshot.deleteMany({ where: { companyId } });
  }

  private async resolveCompanyId(body: {
    companyId?: string;
    email?: string;
  }): Promise<string | null> {
    if (body.companyId) return body.companyId;
    if (!body.email) return null;
    const user = await this.prisma.user.findFirst({
      where: { email: body.email },
      select: { companyId: true },
    });
    return user?.companyId ?? null;
  }

  private assertEnabled(): void {
    const flag = this.config.get<string>('THROTTLER_DISABLED', 'false');
    if (flag !== 'true') {
      // Deliberate: return 403 (not 404) so the test knows the
      // route exists but is gated. In production the ConfigModule
      // validation ensures the flag can never be `true`, so this
      // branch always fires there.
      throw new ForbiddenException('test-support routes disabled');
    }
  }
}
