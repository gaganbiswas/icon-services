import { Global, Module } from '@nestjs/common';

import { PRISMA, PrismaLifecycle, prismaProvider } from './prisma.service.js';

@Global()
@Module({
  providers: [prismaProvider, PrismaLifecycle],
  exports: [PRISMA],
})
export class PrismaModule {}
