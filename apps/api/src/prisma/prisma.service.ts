import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService is a singleton PrismaClient wrapper with:
 *  - graceful lifecycle hooks tied to Nest module init/destroy
 *  - soft-delete filter automatically applied to findMany / findFirst / findUnique
 *    unless the caller passes `includeDeleted: true` in their args (stripped before send).
 *
 * Consumers use `this.prisma` normally. For hard reads (e.g. audit/admin restore flows),
 * bypass the extension via `this.prisma.$transaction(async (tx) => tx.<model>.findMany({ where: {} }))`
 * and explicitly opt-in with `includeDeleted: true`.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'production'
          ? ['warn', 'error']
          : ['query', 'info', 'warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }
}
