import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { HolidayController } from './holiday.controller';
import { HolidayService } from './holiday.service';

@Module({
  imports: [PrismaModule],
  controllers: [HolidayController],
  providers: [HolidayService],
  exports: [HolidayService],
})
export class HolidayModule {}
