import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { GeofenceController } from './geofence.controller';
import { GeofenceService } from './geofence.service';

@Module({
  imports: [PrismaModule],
  controllers: [GeofenceController],
  providers: [GeofenceService],
  exports: [GeofenceService],
})
export class GeofenceModule {}
