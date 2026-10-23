import type { EntityManager } from '@mikro-orm/postgresql';
import type { InboxMessage } from '../../../application/inbox/inbox-message.js';
import type { InboxRepository } from '../../../application/ports/unit-of-work.js';
import { InboxMessageSchema } from '../entities/inbox-message.entity.js';
import { InboxMessageMapper } from '../mappers/inbox-message.mapper.js';

export class MikroOrmInboxRepository implements InboxRepository {
  constructor(private readonly em: EntityManager) {}

  async addIfAbsent(message: InboxMessage): Promise<boolean> {
    const result = await this.em
      .createQueryBuilder(InboxMessageSchema)
      .insert(InboxMessageMapper.toRecord(message))
      .onConflict(['consumerName', 'messageId'])
      .ignore()
      .execute();
    return result.affectedRows === 1;
  }

  async find(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | undefined> {
    const record = await this.em.findOne(InboxMessageSchema, {
      consumerName,
      messageId,
    });
    return record ? InboxMessageMapper.toDomain(record) : undefined;
  }

  async markProcessed(message: InboxMessage): Promise<void> {
    await this.em.nativeUpdate(
      InboxMessageSchema,
      { consumerName: message.consumerName, messageId: message.messageId },
      { processedAt: message.processedAt ?? null },
    );
  }
}
