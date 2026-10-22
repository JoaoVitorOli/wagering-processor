import type { EntityManager } from '@mikro-orm/postgresql';
import type { WagerTransactionRepository } from '../../../application/ports/unit-of-work.js';
import type { WagerTransaction } from '../../../domain/wagering/wager-transaction.js';
import { WagerTransactionSchema } from '../entities/wager-transaction.entity.js';
import { WagerTransactionMapper } from '../mappers/wager-transaction.mapper.js';

export class MikroOrmWagerTransactionRepository
  implements WagerTransactionRepository
{
  constructor(private readonly em: EntityManager) {}

  async add(transaction: WagerTransaction): Promise<void> {
    await this.em.insert(
      WagerTransactionSchema,
      WagerTransactionMapper.toRecord(transaction),
    );
  }
}