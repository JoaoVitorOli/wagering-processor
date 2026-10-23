import type { OutboxMessage } from '../outbox/outbox-message.js';

export const EVENT_PUBLISHER = Symbol('EventPublisher');

export interface EventPublisher {
  publish(message: OutboxMessage): Promise<void>;
}
