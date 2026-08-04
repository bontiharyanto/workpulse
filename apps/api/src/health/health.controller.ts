import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { HealthDeepService } from './health-deep.service';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Public health endpoints.
 *
 * - `GET /api/v1/health`        — shallow. Docker HEALTHCHECK + Caddy uses this.
 *                                  Always returns 200 even if DB is briefly
 *                                  slow (only 5xx if the whole process is broken).
 * - `GET /api/v1/health/deep`   — dependency probe (DB + storage + worker flags).
 *                                  Returns 503 on `degraded` / `down`. External
 *                                  uptime monitors (BetterStack / Uptime Robot)
 *                                  should point HERE, not at the shallow one.
 */
@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deep: HealthDeepService,
  ) {}

  @Get()
  @Public()
  @ApiExcludeEndpoint() // keep swagger clean; ops-only endpoint
  async check(): Promise<{ status: 'ok'; db: 'up' | 'down'; timestamp: string }> {
    let db: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    return { status: 'ok', db, timestamp: new Date().toISOString() };
  }

  @Get('deep')
  @Public()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async checkDeep(@Res({ passthrough: true }) res: Response): Promise<unknown> {
    const result = await this.deep.check();
    // Only `down` (database) blocks traffic entirely. `degraded` (storage) is
    // still a 503 so external monitors alert, but on-call decides the response.
    if (result.status !== 'ok') {
      res.status(503);
    }
    return result;
  }
}
