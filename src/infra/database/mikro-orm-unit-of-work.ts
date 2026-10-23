import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  Repositories,
  UnitOfWork,
} from '../../application/ports/unit-of-work.js';
import { MikroOrmLedgerRepository } from './repositories/mikro-orm-ledger.repository.js';
import { MikroOrmOutboxRepository } from './repositories/mikro-orm-outbox.repository.js';
import { MikroOrmWagerTransactionRepository } from './repositories/mikro-orm-wager-transaction.repository.js';
import { MikroOrmWalletRepository } from './repositories/mikro-orm-wallet.repository.js';

export class MikroOrmUnitOfWork implements UnitOfWork {
  constructor(
    private readonly em: EntityManager,
    private readonly lockTimeoutMs: number,
  ) {}

  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return this.em.transactional(async (em) => {
      await em.execute(`set local lock_timeout = ${this.lockTimeoutMs}`);
      return work({
        wallets: new MikroOrmWalletRepository(em),
        transactions: new MikroOrmWagerTransactionRepository(em),
        ledger: new MikroOrmLedgerRepository(em),
        outbox: new MikroOrmOutboxRepository(em),
      });
    });
  }
}
