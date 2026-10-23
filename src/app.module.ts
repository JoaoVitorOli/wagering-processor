import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DatabaseModule } from './infra/database/database.module.js';
import { MessagingModule } from './infra/messaging/messaging.module.js';
import { ObservabilityModule } from './infra/observability/observability.module.js';
import { SystemModule } from './infra/system/system.module.js';
import { DatabaseErrorFilter } from './interfaces/http/database-error.filter.js';
import { DomainErrorFilter } from './interfaces/http/domain-error.filter.js';
import { HealthModule } from './interfaces/http/health/health.module.js';
import { RequestContextMiddleware } from './interfaces/http/request-context.middleware.js';
import { WageringModule } from './interfaces/http/wagering/wagering.module.js';
import { WalletsModule } from './interfaces/http/wallets/wallets.module.js';
import { PoliciesModule } from './interfaces/policies.module.js';
import { SqsModule } from './interfaces/sqs/sqs.module.js';
import { WorkersModule } from './interfaces/workers/workers.module.js';

@Module({
  imports: [
    DatabaseModule,
    SystemModule,
    MessagingModule,
    ObservabilityModule,
    PoliciesModule,
    WalletsModule,
    WageringModule,
    WorkersModule,
    SqsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: DatabaseErrorFilter },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
