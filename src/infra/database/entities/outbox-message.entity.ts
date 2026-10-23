import { defineEntity, type InferEntity, p } from '@mikro-orm/core';
import type { IntegrationEventEnvelope } from '../../../application/events/integration-event.js';

export const OutboxMessageSchema = defineEntity({
  name: 'OutboxMessage',
  tableName: 'outbox_messages',
  properties: {
    id: p.uuid().primary(),
    aggregateId: p.uuid(),
    eventType: p.string(),
    payload: p.json<IntegrationEventEnvelope<unknown>>(),
    occurredAt: p.datetime(),
    attempts: p.integer(),
    nextAttemptAt: p.datetime(),
    publishedAt: p.datetime().nullable(),
  },
  indexes: [
    {
      name: 'outbox_messages_pending_index',
      properties: ['nextAttemptAt'],
      where: 'published_at is null',
    },
  ],
  checks: [
    { name: 'outbox_messages_attempts_check', expression: 'attempts >= 0' },
  ],
});

export type OutboxMessageRecord = InferEntity<typeof OutboxMessageSchema>;
