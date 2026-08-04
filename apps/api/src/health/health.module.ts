import { Module } from '@nestjs/common';

import { HealthDeepService } from './health-deep.service';
import { HealthController } from './health.controller';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [HealthController],
  providers: [HealthDeepService],
})
export class HealthModule {}
