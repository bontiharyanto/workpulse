import { Module } from '@nestjs/common';

import { TenantUsageController } from './tenant-usage.controller';
import { TenantUsageService } from './tenant-usage.service';
import { TenantUsageWorker } from './tenant-usage.worker';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * OPS-7 — Tenant usage snapshot module. Monthly per-tenant footprint
 * measurement (storage / DB rows / communication volume / active users).
 * Provides a read + regenerate surface at `/admin/usage/*`.
 */
@Module({
  imports: [PrismaModule],
  controllers: [TenantUsageController],
  providers: [TenantUsageService, TenantUsageWorker],
  exports: [TenantUsageService, TenantUsageWorker],
})
export class TenantUsageModule {}
