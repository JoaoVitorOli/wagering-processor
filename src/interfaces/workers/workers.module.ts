import { Module } from '@nestjs/common';
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
import {
  PENDING_REFERENCE_WORKER_CONFIG,
  PendingReferenceWorker,
} from './pending-reference.worker.js';

const DEFAULT_INTERVAL_MS = 1_000;
const BATCH_SIZE = 50;

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
          process.env.PENDING_REFERENCE_WORKER_INTERVAL_MS,
        ),
        batchSize: BATCH_SIZE,
      }),
    },
    PendingReferenceWorker,
  ],
})
export class WorkersModule {}

function parseInterval(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_INTERVAL_MS;
  }
  const milliseconds = Number(value);
  if (!Number.isInteger(milliseconds) || milliseconds <= 0) {
    throw new Error(
      `PENDING_REFERENCE_WORKER_INTERVAL_MS must be a positive integer, got "${value}"`,
    );
  }
  return milliseconds;
}
