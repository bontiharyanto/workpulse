import { Module } from '@nestjs/common';

import { StorageModule } from '../storage/storage.module';

import { HealthDeepService } from './health-deep.service';
import { HealthController } from './health.controller';

@Module({
  imports: [StorageModule],
  controllers: [HealthController],
  providers: [HealthDeepService],
})
export class HealthModule {}
