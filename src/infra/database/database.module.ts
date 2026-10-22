import { MikroOrmModule } from '@mikro-orm/nestjs';
import {
  EntityManager,
  type Options,
  PostgreSqlDriver,
} from '@mikro-orm/postgresql';
import { Global, Module } from '@nestjs/common';
import { UNIT_OF_WORK } from '../../application/ports/unit-of-work.js';
import { MikroOrmUnitOfWork } from './mikro-orm-unit-of-work.js';
import { createOrmConfig } from './mikro-orm.config.js';

export const ORM_CONFIG = Symbol('OrmConfig');

@Global()
@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      driver: PostgreSqlDriver,
      providers: [{ provide: ORM_CONFIG, useFactory: () => createOrmConfig() }],
      inject: [ORM_CONFIG],
      useFactory: (config: Options) => config,
    }),
  ],
  providers: [
    {
      provide: UNIT_OF_WORK,
      useFactory: (em: EntityManager) => new MikroOrmUnitOfWork(em),
      inject: [EntityManager],
    },
  ],
  exports: [UNIT_OF_WORK],
})
export class DatabaseModule {}