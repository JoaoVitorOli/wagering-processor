import { OutboxMessage } from '../../../application/outbox/outbox-message.js';
import type { OutboxMessageRecord } from '../entities/outbox-message.entity.js';

export const OutboxMessageMapper = {
  toRecord(message: OutboxMessage): OutboxMessageRecord {
    return {
      id: message.id,
      aggregateId: message.aggregateId,
      eventType: message.eventType,
      payload: message.payload,
      occurredAt: message.occurredAt,
      attempts: message.attempts,
      nextAttemptAt: message.nextAttemptAt,
      publishedAt: message.publishedAt ?? null,
    };
  },

  toDomain(record: OutboxMessageRecord): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: record.id,
      aggregateId: record.aggregateId,
      eventType: record.eventType,
      payload: record.payload,
      occurredAt: record.occurredAt,
      attempts: record.attempts,
      nextAttemptAt: record.nextAttemptAt,
      publishedAt: record.publishedAt ?? undefined,
    });
  },
};
