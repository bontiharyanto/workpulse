import { Module } from '@nestjs/common';


import { HolidayController } from './holiday.controller';
import { HolidayService } from './holiday.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HolidayController],
  providers: [HolidayService],
  exports: [HolidayService],
})
export class HolidayModule {}
