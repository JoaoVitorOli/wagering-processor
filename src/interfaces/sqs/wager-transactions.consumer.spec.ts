import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { describe, expect, it } from 'bun:test';
import type { ConsumeWagerMessageUseCase } from '../../application/wagering/consume-wager-message.use-case.js';
import { Metrics } from '../../infra/observability/metrics.js';
import {
  type SqsConsumerConfig,
  WagerTransactionsConsumer,
} from './wager-transactions.consumer.js';

const config: SqsConsumerConfig = {
  enabled: false,
  queueUrl: 'queue',
  deadLetterQueueUrl: 'dlq',
  waitTimeSeconds: 0,
  maxMessages: 10,
  retryBaseDelaySeconds: 1,
  retryMaxDelaySeconds: 1,
};

function messageWith(id: string): Message {
  return {
    MessageId: id,
    ReceiptHandle: `receipt-${id}`,
    Body: JSON.stringify({
      messageId: id,
      type: 'WagerTransactionRequested',
      occurredAt: '2026-10-23T12:00:00.000Z',
      data: {
        providerId: 'provider-a',
        externalTransactionId: id,
        idempotencyKey: `provider-a:${id}`,
        playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
        walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount: '1.00', currency: 'BRL' },
      },
    }),
  };
}

describe('WagerTransactionsConsumer shutdown', () => {
  it('finishes the message in progress and returns the rest of the batch to the queue', async () => {
    const commands: unknown[] = [];
    const sqs = {
      send: async (command: unknown) => {
        commands.push(command);
        return {};
      },
    } as unknown as SQSClient;
    let consumer: WagerTransactionsConsumer;
    const processed: string[] = [];
    const useCase = {
      execute: async ({ messageId }: { messageId: string }) => {
        processed.push(messageId);
        await consumer.onApplicationShutdown();
        return { duplicate: true };
      },
    } as unknown as ConsumeWagerMessageUseCase;
    consumer = new WagerTransactionsConsumer(
      sqs,
      useCase,
      config,
      new Metrics(async () => ({ pending: 0, oldestAgeSeconds: 0 })),
    );

    await consumer.processBatch([
      messageWith('m1'),
      messageWith('m2'),
      messageWith('m3'),
    ]);

    expect(processed).toEqual(['m1']);
    const deleted = commands.filter((c) => c instanceof DeleteMessageCommand);
    const released = commands.filter(
      (c) => c instanceof ChangeMessageVisibilityCommand,
    ) as ChangeMessageVisibilityCommand[];
    expect(deleted).toHaveLength(1);
    expect(
      released.map((c) => [c.input.ReceiptHandle, c.input.VisibilityTimeout]),
    ).toEqual([
      ['receipt-m2', 0],
      ['receipt-m3', 0],
    ]);
  });
});
