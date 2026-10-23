import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  type Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConsumeWagerMessageUseCase } from '../../application/wagering/consume-wager-message.use-case.js';
import { DomainError } from '../../domain/shared/domain-error.js';
import { SQS_CLIENT } from '../../infra/messaging/sqs-client.js';
import { isTransientDatabaseError } from '../../infra/database/database-errors.js';
import { failpoint } from '../../infra/failpoints.js';
import { wagerMessageSchema } from './wager-message.schema.js';

export const SQS_CONSUMER_CONFIG = Symbol('SqsConsumerConfig');

export interface SqsConsumerConfig {
  enabled: boolean;
  queueUrl: string;
  deadLetterQueueUrl: string;
  waitTimeSeconds: number;
  maxMessages: number;
  retryBaseDelaySeconds: number;
  retryMaxDelaySeconds: number;
}

type Outcome = 'acked' | 'dead-lettered' | 'retry';

@Injectable()
export class WagerTransactionsConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WagerTransactionsConsumer.name);
  private readonly abort = new AbortController();
  private stopping = false;
  private loop: Promise<void> | undefined;

  constructor(
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    @Inject(ConsumeWagerMessageUseCase)
    private readonly consumeWagerMessage: ConsumeWagerMessageUseCase,
    @Inject(SQS_CONSUMER_CONFIG) private readonly config: SqsConsumerConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.enabled) {
      this.loop = this.poll();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.abort.abort();
    await this.loop;
  }

  private async poll(): Promise<void> {
    while (!this.stopping) {
      let messages: Message[];
      try {
        const response = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: this.config.queueUrl,
            MaxNumberOfMessages: this.config.maxMessages,
            WaitTimeSeconds: this.config.waitTimeSeconds,
            MessageSystemAttributeNames: [
              'ApproximateReceiveCount',
              'MessageGroupId',
            ],
          }),
          { abortSignal: this.abort.signal },
        );
        messages = response.Messages ?? [];
      } catch (error) {
        if (!this.stopping) {
          this.logger.error(error);
          await Bun.sleep(1_000);
        }
        continue;
      }
      await this.processBatch(messages);
    }
  }

  async processBatch(messages: Message[]): Promise<void> {
    for (const [index, message] of messages.entries()) {
      if (this.stopping) {
        await this.release(messages.slice(index));
        return;
      }
      try {
        await this.handle(message);
      } catch (error) {
        this.logger.error(error);
      }
    }
  }

  async handle(message: Message): Promise<Outcome> {
    const parsed = wagerMessageSchema.safeParse(parseJson(message.Body));
    if (!parsed.success) {
      return this.deadLetter(message, 'INVALID_MESSAGE', parsed.error.message);
    }

    try {
      await this.consumeWagerMessage.execute({
        messageId: parsed.data.messageId,
        data: parsed.data.data,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return this.deadLetter(message, error.code, error.message);
      }
      if (!isTransientDatabaseError(error)) {
        this.logger.error(error);
      }
      return this.retryLater(message);
    }

    failpoint('sqs-consumer:after-commit');
    await this.sqs.send(
      new DeleteMessageCommand({
        QueueUrl: this.config.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
    return 'acked';
  }

  private async deadLetter(
    message: Message,
    code: string,
    reason: string,
  ): Promise<Outcome> {
    this.logger.warn(`Message ${message.MessageId} sent to DLQ: ${code}`);
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.config.deadLetterQueueUrl,
        MessageBody: message.Body ?? '',
        MessageGroupId: message.Attributes?.MessageGroupId ?? 'unknown',
        MessageDeduplicationId: message.MessageId,
        MessageAttributes: {
          errorCode: { DataType: 'String', StringValue: code },
          errorReason: {
            DataType: 'String',
            StringValue: reason.slice(0, 1000),
          },
        },
      }),
    );
    await this.sqs.send(
      new DeleteMessageCommand({
        QueueUrl: this.config.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
    return 'dead-lettered';
  }

  private async retryLater(message: Message): Promise<Outcome> {
    const receiveCount = Number(
      message.Attributes?.ApproximateReceiveCount ?? 1,
    );
    const delay = Math.min(
      this.config.retryBaseDelaySeconds * 2 ** (receiveCount - 1),
      this.config.retryMaxDelaySeconds,
    );
    await this.changeVisibility(message, delay);
    return 'retry';
  }

  private async release(messages: Message[]): Promise<void> {
    await Promise.all(
      messages.map((message) => this.changeVisibility(message, 0)),
    );
  }

  private async changeVisibility(message: Message, seconds: number) {
    await this.sqs.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.config.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: seconds,
      }),
    );
  }
}

function parseJson(body: string | undefined): unknown {
  try {
    return JSON.parse(body ?? '');
  } catch {
    return undefined;
  }
}
