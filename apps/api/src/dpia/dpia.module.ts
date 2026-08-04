import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { DpiaAdminController } from './dpia-admin.controller';
import { DpiaExportController } from './dpia-export.controller';
import { DpiaExportService } from './dpia-export.service';
import { DpiaService } from './dpia.service';

@Module({
  imports: [PrismaModule],
  controllers: [DpiaAdminController, DpiaExportController],
  providers: [DpiaService, DpiaExportService],
  exports: [DpiaService],
})
export class DpiaModule {}
