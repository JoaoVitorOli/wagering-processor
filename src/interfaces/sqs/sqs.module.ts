import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../../application/ports/clock.js';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from '../../application/ports/unit-of-work.js';
import { ConsumeWagerMessageUseCase } from '../../application/wagering/consume-wager-message.use-case.js';
import { SubmitWagerTransactionUseCase } from '../../application/wagering/submit-wager-transaction.use-case.js';
import { WageringModule } from '../http/wagering/wagering.module.js';
import {
  SQS_CONSUMER_CONFIG,
  type SqsConsumerConfig,
  WagerTransactionsConsumer,
} from './wager-transactions.consumer.js';

const CONSUMER_NAME = 'wager-transactions';
const DEFAULT_QUEUE_URL =
  'http://localhost:4566/000000000000/wager-transactions.fifo';
const DEFAULT_DLQ_URL =
  'http://localhost:4566/000000000000/wager-transactions-dlq.fifo';

@Module({
  imports: [WageringModule],
  providers: [
    {
      provide: ConsumeWagerMessageUseCase,
      useFactory: (
        unitOfWork: UnitOfWork,
        submitTransaction: SubmitWagerTransactionUseCase,
        clock: Clock,
      ) =>
        new ConsumeWagerMessageUseCase(
          unitOfWork,
          submitTransaction,
          clock,
          CONSUMER_NAME,
        ),
      inject: [UNIT_OF_WORK, SubmitWagerTransactionUseCase, CLOCK],
    },
    {
      provide: SQS_CONSUMER_CONFIG,
      useFactory: (): SqsConsumerConfig => ({
        enabled: process.env.SQS_CONSUMER_ENABLED !== 'false',
        queueUrl: process.env.WAGER_TRANSACTIONS_QUEUE_URL ?? DEFAULT_QUEUE_URL,
        deadLetterQueueUrl:
          process.env.WAGER_TRANSACTIONS_DLQ_URL ?? DEFAULT_DLQ_URL,
        waitTimeSeconds: 20,
        maxMessages: 10,
        retryBaseDelaySeconds: 2,
        retryMaxDelaySeconds: 60,
      }),
    },
    WagerTransactionsConsumer,
  ],
})
export class SqsModule {}
