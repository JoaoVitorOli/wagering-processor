import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PublishOutboxUseCase } from '../../application/outbox/publish-outbox.use-case.js';

export const OUTBOX_PUBLISHER_CONFIG = Symbol('OutboxPublisherConfig');

const MAX_ROUNDS_PER_TICK = 20;

export interface OutboxPublisherConfig {
  enabled: boolean;
  queueUrl: string;
  intervalMs: number;
  batchSize: number;
}

@Injectable()
export class OutboxPublisherWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OutboxPublisherWorker.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;

  constructor(
    @Inject(PublishOutboxUseCase)
    private readonly publishOutbox: PublishOutboxUseCase,
    @Inject(OUTBOX_PUBLISHER_CONFIG)
    private readonly config: OutboxPublisherConfig,
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
    this.running = this.drain()
      .catch((error: unknown) => this.logger.error(error))
      .finally(() => {
        this.running = undefined;
      });
  }

  private async drain(): Promise<void> {
    for (let round = 0; round < MAX_ROUNDS_PER_TICK; round++) {
      const { published, failures } = await this.publishOutbox.execute(
        this.config.batchSize,
      );
      for (const failure of failures) {
        this.logger.warn(failure);
      }
      if (published === 0) {
        return;
      }
    }
  }
}
