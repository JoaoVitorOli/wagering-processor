import { MikroORM } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import { createOrmConfig } from '../../src/infra/database/mikro-orm.config.js';

export interface TestDatabase {
  name: string;
  orm: MikroORM;
  drop(): Promise<void>;
}

export interface TestDatabaseOptions {
  checkLedgerOnDrop?: boolean;
}

async function runOnMainDatabase(sql: string): Promise<void> {
  const orm = await MikroORM.init(createOrmConfig());
  try {
    await orm.em.getConnection().execute(sql);
  } finally {
    await orm.close();
  }
}

export async function inconsistentWallets(orm: MikroORM) {
  return orm.em
    .getConnection()
    .execute<{ id: string; balance: string; ledger_balance: string }[]>(
      `select w.id, w.balance,
            coalesce(sum(case e.direction when 'CREDIT' then e.amount else -e.amount end), 0) as ledger_balance
       from wallets w
       left join wallet_ledger_entries e on e.wallet_id = w.id
      group by w.id
     having w.balance <> coalesce(sum(case e.direction when 'CREDIT' then e.amount else -e.amount end), 0)`,
    );
}

export async function createTestDatabase(
  options: TestDatabaseOptions = {},
): Promise<TestDatabase> {
  const name = `wagering_test_${randomUUID().replaceAll('-', '')}`;
  await runOnMainDatabase(`create database "${name}"`);

  const orm = await MikroORM.init(createOrmConfig(name));
  await orm.migrator.up();

  return {
    name,
    orm,
    async drop() {
      const inconsistent =
        options.checkLedgerOnDrop === false
          ? []
          : await inconsistentWallets(orm);
      await orm.close();
      await runOnMainDatabase(`drop database if exists "${name}" with (force)`);
      if (inconsistent.length > 0) {
        throw new Error(
          `Wallet balance differs from its ledger: ${JSON.stringify(inconsistent)}`,
        );
      }
    },
  };
}
