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
}

export async function createTestApp(
  databaseName: string,
  options: TestAppOptions = {},
): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
    .compile();

  const app: INestApplication = moduleRef.createNestApplication({
    logger: false,
  });
  await app.listen(0);

  return {
    url: await app.getUrl(),
    close: () => app.close(),
  };
}
