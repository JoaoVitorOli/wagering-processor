import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { OutboxMessage } from '../../application/outbox/outbox-message.js';
import type { EventPublisher } from '../../application/ports/event-publisher.js';

export class SqsEventPublisher implements EventPublisher {
  constructor(
    private readonly sqs: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async publish(message: OutboxMessage): Promise<void> {
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message.payload),
        MessageGroupId: message.aggregateId,
        MessageDeduplicationId: message.id,
        MessageAttributes: {
          eventType: { DataType: 'String', StringValue: message.eventType },
        },
      }),
    );
  }
}
