export enum FailureCode {
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  CurrencyMismatch = 'CURRENCY_MISMATCH',
  PlayerMismatch = 'PLAYER_MISMATCH',
  ReversalWouldOverdraw = 'REVERSAL_WOULD_OVERDRAW',
  ReferenceContextMismatch = 'REFERENCE_CONTEXT_MISMATCH',
  ReferenceKindNotAllowed = 'REFERENCE_KIND_NOT_ALLOWED',
  ReferenceNotProcessed = 'REFERENCE_NOT_PROCESSED',
  ReferenceAlreadyReversed = 'REFERENCE_ALREADY_REVERSED',
  AmountMismatch = 'AMOUNT_MISMATCH',
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  ProcessingFailed = 'PROCESSING_FAILED',
}
