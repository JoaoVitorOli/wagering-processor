import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  Repositories,
  UnitOfWork,
} from '../../application/ports/unit-of-work.js';
import { MikroOrmLedgerRepository } from './repositories/mikro-orm-ledger.repository.js';
import { MikroOrmWagerTransactionRepository } from './repositories/mikro-orm-wager-transaction.repository.js';
import { MikroOrmWalletRepository } from './repositories/mikro-orm-wallet.repository.js';

export class MikroOrmUnitOfWork implements UnitOfWork {
  constructor(private readonly em: EntityManager) {}

  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return this.em.transactional((em) =>
      work({
        wallets: new MikroOrmWalletRepository(em),
        transactions: new MikroOrmWagerTransactionRepository(em),
        ledger: new MikroOrmLedgerRepository(em),
      }),
    );
  }
}
