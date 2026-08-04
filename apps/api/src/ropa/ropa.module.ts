import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { RopaAdminController } from './ropa-admin.controller';
import { RopaExportController } from './ropa-export.controller';
import { RopaExportService } from './ropa-export.service';
import { RopaRegistryService } from './ropa-registry.service';

/**
 * Fase 31d — ROPA (Record of Processing Activities) registry.
 *
 * Endpoints:
 *   - `/admin/ropa/activities`                — CRUD + seed-defaults
 *   - `/admin/ropa/activities/:id`            — detail (all versions)
 *   - `/admin/ropa/activities/:a/versions/:v/{submit-review,return-to-draft,publish}`
 *   - `/admin/ropa/activities/:a/new-version` — fork DRAFT from previous version
 *   - `/admin/ropa/export.pdf`                — regulator-facing PDF export
 *   - `/admin/ropa/export.xlsx`               — raw-data XLSX export
 */
@Module({
  imports: [PrismaModule],
  controllers: [RopaAdminController, RopaExportController],
  providers: [RopaRegistryService, RopaExportService],
  exports: [RopaRegistryService, RopaExportService],
})
export class RopaModule {}
