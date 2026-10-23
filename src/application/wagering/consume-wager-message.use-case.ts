import { InboxMessage } from '../inbox/inbox-message.js';
import { InboxMessageConflictError } from '../inbox/inbox.errors.js';
import type { Clock } from '../ports/clock.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';
import { hashCanonical } from './payload-hash.js';
import type {
  SubmitWagerTransactionInput,
  SubmitWagerTransactionResult,
  SubmitWagerTransactionUseCase,
} from './submit-wager-transaction.use-case.js';

export interface WagerMessage {
  messageId: string;
  data: SubmitWagerTransactionInput;
}

export type ConsumeWagerMessageResult =
  | { duplicate: true }
  | { duplicate: false; result: SubmitWagerTransactionResult };

export class ConsumeWagerMessageUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly submitTransaction: SubmitWagerTransactionUseCase,
    private readonly clock: Clock,
    private readonly consumerName: string,
  ) {}

  execute(message: WagerMessage): Promise<ConsumeWagerMessageResult> {
    return this.unitOfWork.run(async (repositories) => {
      const inbox = InboxMessage.receive({
        consumerName: this.consumerName,
        messageId: message.messageId,
        payloadHash: hashCanonical(message.data),
        receivedAt: this.clock.now(),
      });

      if (!(await repositories.inbox.addIfAbsent(inbox))) {
        const existing = await repositories.inbox.find(
          this.consumerName,
          message.messageId,
        );
        if (existing?.payloadHash !== inbox.payloadHash) {
          throw new InboxMessageConflictError(message.messageId);
        }
        return { duplicate: true };
      }

      const result = await this.submitTransaction.executeIn(
        repositories,
        message.data,
      );
      inbox.markProcessed(this.clock.now());
      await repositories.inbox.markProcessed(inbox);
      return { duplicate: false, result };
    });
  }
}
