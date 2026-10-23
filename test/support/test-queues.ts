import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  type Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { randomUUID } from 'node:crypto';

export interface TestQueues {
  queueUrl: string;
  deadLetterQueueUrl: string;
  delete(): Promise<void>;
}

export async function createTestQueues(
  sqs: SQSClient,
  options: { visibilityTimeoutSeconds: number; maxReceiveCount: number },
): Promise<TestQueues> {
  const prefix = `test-${randomUUID().slice(0, 8)}`;
  const fifo = { FifoQueue: 'true', ContentBasedDeduplication: 'false' };

  const dlq = await sqs.send(
    new CreateQueueCommand({
      QueueName: `${prefix}-dlq.fifo`,
      Attributes: fifo,
    }),
  );
  const { Attributes } = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: dlq.QueueUrl,
      AttributeNames: ['QueueArn'],
    }),
  );
  const main = await sqs.send(
    new CreateQueueCommand({
      QueueName: `${prefix}.fifo`,
      Attributes: {
        ...fifo,
        VisibilityTimeout: String(options.visibilityTimeoutSeconds),
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: Attributes?.QueueArn,
          maxReceiveCount: String(options.maxReceiveCount),
        }),
      },
    }),
  );

  return {
    queueUrl: main.QueueUrl ?? '',
    deadLetterQueueUrl: dlq.QueueUrl ?? '',
    async delete() {
      await sqs.send(new DeleteQueueCommand({ QueueUrl: main.QueueUrl }));
      await sqs.send(new DeleteQueueCommand({ QueueUrl: dlq.QueueUrl }));
    },
  };
}

export function sendMessage(
  sqs: SQSClient,
  queueUrl: string,
  body: unknown,
  groupId: string,
) {
  return sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: typeof body === 'string' ? body : JSON.stringify(body),
      MessageGroupId: groupId,
      MessageDeduplicationId: randomUUID(),
    }),
  );
}

export async function receiveAll(
  sqs: SQSClient,
  queueUrl: string,
): Promise<Message[]> {
  const { Messages } = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 1,
      MessageAttributeNames: ['All'],
      VisibilityTimeout: 0,
    }),
  );
  return Messages ?? [];
}

export async function queueDepth(
  sqs: SQSClient,
  queueUrl: string,
): Promise<number> {
  const { Attributes } = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: [
        'ApproximateNumberOfMessages',
        'ApproximateNumberOfMessagesNotVisible',
      ],
    }),
  );
  return (
    Number(Attributes?.ApproximateNumberOfMessages ?? 0) +
    Number(Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0)
  );
}

export async function eventually(
  check: () => Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error('Condition not met in time');
    }
    await Bun.sleep(100);
  }
}
