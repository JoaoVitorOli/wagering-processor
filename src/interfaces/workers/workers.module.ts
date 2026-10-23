import type { SQSClient } from '@aws-sdk/client-sqs';
import { Module } from '@nestjs/common';
import { PublishOutboxUseCase } from '../../application/outbox/publish-outbox.use-case.js';
import { CLOCK, type Clock } from '../../application/ports/clock.js';
import {
  ID_GENERATOR,
  type IdGenerator,
} from '../../application/ports/id-generator.js';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from '../../application/ports/unit-of-work.js';
import {
  REFERENCE_RETRY_POLICY,
  type ReferenceRetryPolicy,
} from '../../application/wagering/reference-retry-policy.js';
import { ResolvePendingReferencesUseCase } from '../../application/wagering/resolve-pending-references.use-case.js';
import { SQS_CLIENT } from '../../infra/messaging/sqs-client.js';
import { SqsEventPublisher } from '../../infra/messaging/sqs-event-publisher.js';
import {
  OUTBOX_PUBLISHER_CONFIG,
  type OutboxPublisherConfig,
  OutboxPublisherWorker,
} from './outbox-publisher.worker.js';
import {
  PENDING_REFERENCE_WORKER_CONFIG,
  PendingReferenceWorker,
} from './pending-reference.worker.js';

const DEFAULT_INTERVAL_MS = 1_000;
const BATCH_SIZE = 50;
const DEFAULT_EVENTS_QUEUE_URL =
  'http://localhost:4566/000000000000/wagering-events.fifo';

@Module({
  providers: [
    {
      provide: ResolvePendingReferencesUseCase,
      useFactory: (
        unitOfWork: UnitOfWork,
        ids: IdGenerator,
        clock: Clock,
        policy: ReferenceRetryPolicy,
      ) => new ResolvePendingReferencesUseCase(unitOfWork, ids, clock, policy),
      inject: [UNIT_OF_WORK, ID_GENERATOR, CLOCK, REFERENCE_RETRY_POLICY],
    },
    {
      provide: PENDING_REFERENCE_WORKER_CONFIG,
      useFactory: () => ({
        enabled: process.env.PENDING_REFERENCE_WORKER_ENABLED !== 'false',
        intervalMs: parseInterval(
          'PENDING_REFERENCE_WORKER_INTERVAL_MS',
          process.env.PENDING_REFERENCE_WORKER_INTERVAL_MS,
        ),
        batchSize: BATCH_SIZE,
      }),
    },
    PendingReferenceWorker,
    {
      provide: PublishOutboxUseCase,
      useFactory: (
        unitOfWork: UnitOfWork,
        sqs: SQSClient,
        clock: Clock,
        config: OutboxPublisherConfig,
      ) =>
        new PublishOutboxUseCase(
          unitOfWork,
          new SqsEventPublisher(sqs, config.queueUrl),
          clock,
        ),
      inject: [UNIT_OF_WORK, SQS_CLIENT, CLOCK, OUTBOX_PUBLISHER_CONFIG],
    },
    {
      provide: OUTBOX_PUBLISHER_CONFIG,
      useFactory: (): OutboxPublisherConfig => ({
        enabled: process.env.OUTBOX_PUBLISHER_ENABLED !== 'false',
        queueUrl:
          process.env.WAGERING_EVENTS_QUEUE_URL ?? DEFAULT_EVENTS_QUEUE_URL,
        intervalMs: parseInterval(
          'OUTBOX_PUBLISHER_INTERVAL_MS',
          process.env.OUTBOX_PUBLISHER_INTERVAL_MS,
        ),
        batchSize: BATCH_SIZE,
      }),
    },
    OutboxPublisherWorker,
  ],
})
export class WorkersModule {}

function parseInterval(name: string, value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_INTERVAL_MS;
  }
  const milliseconds = Number(value);
  if (!Number.isInteger(milliseconds) || milliseconds <= 0) {
    throw new Error(`${name} must be a positive integer, got "${value}"`);
  }
  return milliseconds;
}
