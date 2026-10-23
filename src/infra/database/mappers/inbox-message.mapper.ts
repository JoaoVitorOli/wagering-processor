import { InboxMessage } from '../../../application/inbox/inbox-message.js';
import type { InboxMessageRecord } from '../entities/inbox-message.entity.js';

export const InboxMessageMapper = {
  toRecord(message: InboxMessage): InboxMessageRecord {
    return {
      consumerName: message.consumerName,
      messageId: message.messageId,
      payloadHash: message.payloadHash,
      receivedAt: message.receivedAt,
      processedAt: message.processedAt ?? null,
    };
  },

  toDomain(record: InboxMessageRecord): InboxMessage {
    return InboxMessage.rehydrate({
      consumerName: record.consumerName,
      messageId: record.messageId,
      payloadHash: record.payloadHash,
      receivedAt: record.receivedAt,
      processedAt: record.processedAt ?? undefined,
    });
  },
};
