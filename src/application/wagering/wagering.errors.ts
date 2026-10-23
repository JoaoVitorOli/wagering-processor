import { DomainError } from '../../domain/shared/domain-error.js';

export class IdempotencyConflictError extends DomainError {
  readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor(idempotencyKey: string) {
    super(
      `Idempotency key ${idempotencyKey} was already used with a different payload`,
    );
  }
}

export class TransactionNotFoundError extends DomainError {
  readonly code = 'TRANSACTION_NOT_FOUND';

  constructor(description: string) {
    super(`Transaction ${description} not found`);
  }
}

export class ExternalTransactionConflictError extends DomainError {
  readonly code = 'EXTERNAL_TRANSACTION_CONFLICT';

  constructor(providerId: string, externalTransactionId: string) {
    super(
      `Transaction ${externalTransactionId} from ${providerId} was already submitted with another idempotency key`,
    );
  }
}
