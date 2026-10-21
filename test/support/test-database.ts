import { MikroORM } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import { createOrmConfig } from '../../src/infra/database/mikro-orm.config.js';

export interface TestDatabase {
  name: string;
  orm: MikroORM;
  drop(): Promise<void>;
}

async function runOnMainDatabase(sql: string): Promise<void> {
  const orm = await MikroORM.init(createOrmConfig());
  try {
    await orm.em.getConnection().execute(sql);
  } finally {
    await orm.close();
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `wagering_test_${randomUUID().replaceAll('-', '')}`;
  await runOnMainDatabase(`create database "${name}"`);

  const orm = await MikroORM.init(createOrmConfig(name));
  await orm.migrator.up();

  return {
    name,
    orm,
    async drop() {
      await orm.close();
      await runOnMainDatabase(`drop database if exists "${name}" with (force)`);
    },
  };
}
