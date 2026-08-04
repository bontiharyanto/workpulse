import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

import { UserAdminController } from './user-admin.controller';
import { UserAdminService } from './user-admin.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UserAdminController],
  providers: [UserAdminService],
  exports: [UserAdminService],
})
export class UserAdminModule {}
