import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';
import { OutboxMessageSchema } from './entities/outbox-message.entity.js';
import { WagerTransactionSchema } from './entities/wager-transaction.entity.js';
import { WalletLedgerEntrySchema } from './entities/wallet-ledger-entry.entity.js';
import { WalletSchema } from './entities/wallet.entity.js';

export function createOrmConfig(dbName = process.env.POSTGRES_DB) {
  return defineConfig({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    dbName,
    entities: [
      WalletSchema,
      WagerTransactionSchema,
      WalletLedgerEntrySchema,
      OutboxMessageSchema,
    ],
    extensions: [Migrator],
    migrations: {
      path: 'src/infra/database/migrations',
      pathTs: 'src/infra/database/migrations',
      transactional: true,
      allOrNothing: true,
      snapshotName: '.snapshot',
      snapshotOnMigrate: false,
    },
  });
}

export default createOrmConfig();
