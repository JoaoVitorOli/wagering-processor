import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DatabaseModule } from './infra/database/database.module.js';
import { SystemModule } from './infra/system/system.module.js';
import { DatabaseErrorFilter } from './interfaces/http/database-error.filter.js';
import { DomainErrorFilter } from './interfaces/http/domain-error.filter.js';
import { WageringModule } from './interfaces/http/wagering/wagering.module.js';
import { WalletsModule } from './interfaces/http/wallets/wallets.module.js';
import { PoliciesModule } from './interfaces/policies.module.js';
import { WorkersModule } from './interfaces/workers/workers.module.js';

@Module({
  imports: [
    DatabaseModule,
    SystemModule,
    PoliciesModule,
    WalletsModule,
    WageringModule,
    WorkersModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: DatabaseErrorFilter },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule {}
