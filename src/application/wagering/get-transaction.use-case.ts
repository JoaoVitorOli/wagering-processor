import type { WagerTransaction } from '../../domain/wagering/wager-transaction.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';
import { TransactionNotFoundError } from './wagering.errors.js';

export class GetTransactionUseCase {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async byId(transactionId: string): Promise<WagerTransaction> {
    const transaction = await this.unitOfWork.run(({ transactions }) =>
      transactions.findById(transactionId),
    );
    if (!transaction) {
      throw new TransactionNotFoundError(transactionId);
    }
    return transaction;
  }

  async byExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction> {
    const transaction = await this.unitOfWork.run(({ transactions }) =>
      transactions.findByExternalId(providerId, externalTransactionId),
    );
    if (!transaction) {
      throw new TransactionNotFoundError(
        `${externalTransactionId} from ${providerId}`,
      );
    }
    return transaction;
  }
}
