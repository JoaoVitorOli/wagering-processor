import type { SQSClient } from '@aws-sdk/client-sqs';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import {
  LOCK_TIMEOUT_MS,
  ORM_CONFIG,
} from '../../src/infra/database/database.module.js';
import {
  DEFAULT_REFERENCE_RETRY_POLICY,
  REFERENCE_RETRY_POLICY,
  type ReferenceRetryPolicy,
} from '../../src/application/wagering/reference-retry-policy.js';
import { createOrmConfig } from '../../src/infra/database/mikro-orm.config.js';
import { SQS_CLIENT } from '../../src/infra/messaging/sqs-client.js';
import {
  OUTBOX_PUBLISHER_CONFIG,
  type OutboxPublisherConfig,
} from '../../src/interfaces/workers/outbox-publisher.worker.js';
import {
  SQS_CONSUMER_CONFIG,
  type SqsConsumerConfig,
} from '../../src/interfaces/sqs/wager-transactions.consumer.js';
import {
  PENDING_REFERENCE_WORKER_CONFIG,
  type PendingReferenceWorkerConfig,
} from '../../src/interfaces/workers/pending-reference.worker.js';

export interface TestApp {
  url: string;
  close(): Promise<void>;
}

export interface TestAppOptions {
  lockTimeoutMs?: number;
  referenceRetryPolicy?: ReferenceRetryPolicy;
  pendingReferenceWorker?: PendingReferenceWorkerConfig;
  sqsConsumer?: SqsConsumerConfig;
  sqsClient?: SQSClient;
  outboxPublisher?: OutboxPublisherConfig;
}

export async function createTestApp(
  databaseName: string,
  options: TestAppOptions = {},
): Promise<TestApp> {
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ORM_CONFIG)
    .useValue(createOrmConfig(databaseName))
    .overrideProvider(LOCK_TIMEOUT_MS)
    .useValue(options.lockTimeoutMs ?? 5000)
    .overrideProvider(REFERENCE_RETRY_POLICY)
    .useValue(options.referenceRetryPolicy ?? DEFAULT_REFERENCE_RETRY_POLICY)
    .overrideProvider(PENDING_REFERENCE_WORKER_CONFIG)
    .useValue(
      options.pendingReferenceWorker ?? {
        enabled: false,
        intervalMs: 1000,
        batchSize: 50,
      },
    )
    .overrideProvider(SQS_CONSUMER_CONFIG)
    .useValue(
      options.sqsConsumer ?? {
        enabled: false,
        queueUrl: '',
        deadLetterQueueUrl: '',
        waitTimeSeconds: 0,
        maxMessages: 10,
        retryBaseDelaySeconds: 1,
        retryMaxDelaySeconds: 1,
      },
    )
    .overrideProvider(OUTBOX_PUBLISHER_CONFIG)
    .useValue(
      options.outboxPublisher ?? {
        enabled: false,
        queueUrl: '',
        intervalMs: 1000,
        batchSize: 50,
      },
    );
  if (options.sqsClient) {
    builder.overrideProvider(SQS_CLIENT).useValue(options.sqsClient);
  }
  const moduleRef = await builder.compile();

  const app: INestApplication = moduleRef.createNestApplication({
    logger: false,
  });
  await app.listen(0);

  return {
    url: await app.getUrl(),
    close: () => app.close(),
  };
}
