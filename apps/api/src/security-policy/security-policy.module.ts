import { Module } from '@nestjs/common';

import { SecurityPolicyController } from './security-policy.controller';
import { SecurityPolicyService } from './security-policy.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Tenant-scoped security policy module.
 *
 * `SecurityPolicyService` is exported so `MfaEnrollmentGuard`
 * (registered globally in `app.module.ts`) can inject it — the
 * guard reads the tenant's toggle on every request via the
 * service's short-TTL cache. See the service class doc for the
 * full lookup contract.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SecurityPolicyController],
  providers: [SecurityPolicyService],
  exports: [SecurityPolicyService],
})
export class SecurityPolicyModule {}
