import { Module } from '@nestjs/common';

import { DpiaAdminController } from './dpia-admin.controller';
import { DpiaExportController } from './dpia-export.controller';
import { DpiaExportService } from './dpia-export.service';
import { DpiaService } from './dpia.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DpiaAdminController, DpiaExportController],
  providers: [DpiaService, DpiaExportService],
  exports: [DpiaService],
})
export class DpiaModule {}
