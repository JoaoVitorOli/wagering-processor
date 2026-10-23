import type { EntityManager } from '@mikro-orm/postgresql';
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
}
