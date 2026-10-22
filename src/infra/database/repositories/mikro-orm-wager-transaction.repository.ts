import type { EntityManager } from '@mikro-orm/postgresql';
import type { WagerTransactionRepository } from '../../../application/ports/unit-of-work.js';
import {
  type WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction.js';
import { WagerTransactionSchema } from '../entities/wager-transaction.entity.js';
import { WagerTransactionMapper } from '../mappers/wager-transaction.mapper.js';

export class MikroOrmWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  async add(transaction: WagerTransaction): Promise<void> {
    await this.em.insert(
      WagerTransactionSchema,
      WagerTransactionMapper.toRecord(transaction),
    );
  }

  async addIfAbsent(transaction: WagerTransaction): Promise<boolean> {
    const result = await this.em
      .createQueryBuilder(WagerTransactionSchema)
      .insert(WagerTransactionMapper.toRecord(transaction))
      .onConflict()
      .ignore()
      .execute();
    return result.affectedRows === 1;
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WagerTransaction | undefined> {
    const record = await this.em.findOne(
      WagerTransactionSchema,
      { idempotencyKey },
      { populate: ['wallet'] },
    );
    return record ? WagerTransactionMapper.toDomain(record) : undefined;
  }

  async findByExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | undefined> {
    const record = await this.em.findOne(
      WagerTransactionSchema,
      { providerId, externalTransactionId },
      { populate: ['wallet'] },
    );
    return record ? WagerTransactionMapper.toDomain(record) : undefined;
  }

  async isReversed(transactionId: string): Promise<boolean> {
    const reversals = await this.em.count(WagerTransactionSchema, {
      referenceTransaction: transactionId,
      status: WagerTransactionStatus.Processed,
      kind: {
        $in: [WagerTransactionKind.Refund, WagerTransactionKind.Rollback],
      },
    });
    return reversals > 0;
  }

  async update(transaction: WagerTransaction): Promise<void> {
    const record = WagerTransactionMapper.toRecord(transaction);
    await this.em.nativeUpdate(
      WagerTransactionSchema,
      { id: transaction.id },
      {
        status: record.status,
        failureCode: record.failureCode,
        resultBalance: record.resultBalance,
        referenceTransaction: record.referenceTransaction,
        processedAt: record.processedAt,
      },
    );
  }
}
