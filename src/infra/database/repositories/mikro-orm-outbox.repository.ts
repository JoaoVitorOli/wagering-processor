import { type EntityManager, LockMode } from '@mikro-orm/postgresql';
import type { OutboxMessage } from '../../../application/outbox/outbox-message.js';
import type { OutboxRepository } from '../../../application/ports/unit-of-work.js';
import { OutboxMessageSchema } from '../entities/outbox-message.entity.js';
import { OutboxMessageMapper } from '../mappers/outbox-message.mapper.js';

export class MikroOrmOutboxRepository implements OutboxRepository {
  constructor(private readonly em: EntityManager) {}

  async add(messages: OutboxMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }
    await this.em.insertMany(
      OutboxMessageSchema,
      messages.map(OutboxMessageMapper.toRecord),
    );
  }

  async claimDue(now: Date, limit: number): Promise<OutboxMessage[]> {
    const records = await this.em
      .createQueryBuilder(OutboxMessageSchema, 'm')
      .select('*')
      .where({ publishedAt: null, nextAttemptAt: { $lte: now } })
      .andWhere(
        `not exists (
          select 1 from outbox_messages older
           where older.aggregate_id = m.aggregate_id
             and older.published_at is null
             and (older.occurred_at, older.id) < (m.occurred_at, m.id)
        )`,
      )
      .orderBy({ occurredAt: 'asc', id: 'asc' })
      .limit(limit)
      .setLockMode(LockMode.PESSIMISTIC_PARTIAL_WRITE)
      .getResultList();
    return records.map(OutboxMessageMapper.toDomain);
  }

  async update(message: OutboxMessage): Promise<void> {
    await this.em.nativeUpdate(
      OutboxMessageSchema,
      { id: message.id },
      {
        attempts: message.attempts,
        nextAttemptAt: message.nextAttemptAt,
        publishedAt: message.publishedAt ?? null,
      },
    );
  }
}
