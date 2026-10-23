import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ResolvePendingReferencesUseCase } from '../../application/wagering/resolve-pending-references.use-case.js';

export const PENDING_REFERENCE_WORKER_CONFIG = Symbol(
  'PendingReferenceWorkerConfig',
);

export interface PendingReferenceWorkerConfig {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
}

@Injectable()
export class PendingReferenceWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;

  constructor(
    @Inject(ResolvePendingReferencesUseCase)
    private readonly resolvePendingReferences: ResolvePendingReferencesUseCase,
    @Inject(PENDING_REFERENCE_WORKER_CONFIG)
    private readonly config: PendingReferenceWorkerConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.enabled) {
      this.timer = setInterval(() => this.tick(), this.config.intervalMs);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  private tick(): void {
    if (this.running) {
      return;
    }
    this.running = this.resolvePendingReferences
      .execute(this.config.batchSize)
      .then(({ failures }) => {
        for (const failure of failures) {
          this.logger.warn(failure);
        }
      })
      .catch((error: unknown) => this.logger.error(error))
      .finally(() => {
        this.running = undefined;
      });
  }
}
