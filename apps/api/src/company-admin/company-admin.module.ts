import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

import { CompanyAdminController } from './company-admin.controller';
import { CompanyAdminService } from './company-admin.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CompanyAdminController],
  providers: [CompanyAdminService],
  exports: [CompanyAdminService],
})
export class CompanyAdminModule {}
