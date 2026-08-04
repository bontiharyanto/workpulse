import { Module } from '@nestjs/common';

import { ConsentAdminController } from './consent-admin.controller';
import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Privacy-policy + user-consent surface (Fase 31c). The service is
 * exported so `AuthController.toDto` and `ConsentAcceptedGuard` can
 * both read pending consent without hitting the DB layer directly.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ConsentController, ConsentAdminController],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
