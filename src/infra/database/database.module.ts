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
export const LOCK_TIMEOUT_MS = Symbol('LockTimeoutMs');

const DEFAULT_LOCK_TIMEOUT_MS = 5000;

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
      provide: LOCK_TIMEOUT_MS,
      useFactory: () => parseLockTimeout(process.env.LOCK_TIMEOUT_MS),
    },
    {
      provide: UNIT_OF_WORK,
      useFactory: (em: EntityManager, lockTimeoutMs: number) =>
        new MikroOrmUnitOfWork(em, lockTimeoutMs),
      inject: [EntityManager, LOCK_TIMEOUT_MS],
    },
  ],
  exports: [UNIT_OF_WORK],
})
export class DatabaseModule {}

function parseLockTimeout(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_LOCK_TIMEOUT_MS;
  }
  const milliseconds = Number(value);
  if (!Number.isInteger(milliseconds) || milliseconds <= 0) {
    throw new Error(
      `LOCK_TIMEOUT_MS must be a positive integer, got "${value}"`,
    );
  }
  return milliseconds;
}
