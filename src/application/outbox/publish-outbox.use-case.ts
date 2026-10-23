import type { Clock } from '../ports/clock.js';
import type { EventPublisher } from '../ports/event-publisher.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface PublishOutboxResult {
  published: number;
  failures: unknown[];
}

export class PublishOutboxUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly publisher: EventPublisher,
    private readonly clock: Clock,
  ) {}

  execute(limit: number): Promise<PublishOutboxResult> {
    return this.unitOfWork.run(async ({ outbox }) => {
      const messages = await outbox.claimDue(this.clock.now(), limit);
      const failures: unknown[] = [];
      let published = 0;

      for (const message of messages) {
        try {
          await this.publisher.publish(message);
          message.markPublished(this.clock.now());
          published++;
        } catch (error) {
          message.scheduleRetry(this.clock.now());
          failures.push(error);
        }
        await outbox.update(message);
      }

      return { published, failures };
    });
  }
}
