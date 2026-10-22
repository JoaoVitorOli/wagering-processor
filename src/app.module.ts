import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DatabaseModule } from './infra/database/database.module.js';
import { SystemModule } from './infra/system/system.module.js';
import { DomainErrorFilter } from './interfaces/http/domain-error.filter.js';
import { WalletsModule } from './interfaces/http/wallets/wallets.module.js';

@Module({
  imports: [DatabaseModule, SystemModule, WalletsModule],
  providers: [{ provide: APP_FILTER, useClass: DomainErrorFilter }],
})
export class AppModule {}
