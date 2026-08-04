import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import { OvertimeCompletionService, type CompletionRunResult } from './overtime-completion.service';

@ApiTags('overtime-admin')
@ApiBearerAuth()
@Controller({ path: 'admin/overtime', version: '1' })
@Roles('HR_MANAGER', 'SUPER_ADMIN')
// Completion is cheap but touches every recent APPROVED row. Cap at 4/min so a
// panicked admin cannot swamp the DB by hammering the "Run" button.
@Throttle({ default: { limit: 4, ttl: 60_000 } })
export class OvertimeAdminController {
  constructor(private readonly completion: OvertimeCompletionService) {}

  /**
   * Manual trigger for the daily completion scheduler. Scoped to the caller's
   * tenant — even a SUPER_ADMIN acting from tenant A cannot promote rows in
   * tenant B via this endpoint.
   */
  @Post('run-completion')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Result counts for the run: scanned, completed, skipped by reason, duration.',
  })
  async runCompletion(@CurrentUser() actor: AuthenticatedUser): Promise<CompletionRunResult> {
    return this.completion.runCompletion({ companyId: actor.companyId });
  }
}
