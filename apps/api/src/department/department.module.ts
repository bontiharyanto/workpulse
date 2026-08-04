import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { DepartmentController } from './department.controller';
import { DepartmentService } from './department.service';

@Module({
  imports: [PrismaModule],
  controllers: [DepartmentController],
  providers: [DepartmentService],
  exports: [DepartmentService],
})
export class DepartmentModule {}
