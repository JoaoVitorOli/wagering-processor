import { DomainError } from '../shared/domain-error.js';

export class InsufficientFundsError extends DomainError {
  readonly code = 'INSUFFICIENT_FUNDS';
}

export class InvalidMovementAmountError extends DomainError {
  readonly code = 'INVALID_MOVEMENT_AMOUNT';
}

export class InvalidLedgerEntryError extends DomainError {
  readonly code = 'INVALID_LEDGER_ENTRY';
}
