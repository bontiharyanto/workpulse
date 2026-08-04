import { Module } from '@nestjs/common';

import { GeofenceController } from './geofence.controller';
import { GeofenceService } from './geofence.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [GeofenceController],
  providers: [GeofenceService],
  exports: [GeofenceService],
})
export class GeofenceModule {}
