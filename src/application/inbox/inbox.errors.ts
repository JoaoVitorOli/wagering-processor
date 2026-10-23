import { DomainError } from '../../domain/shared/domain-error.js';

export class InboxMessageConflictError extends DomainError {
  readonly code = 'INBOX_MESSAGE_CONFLICT';

  constructor(messageId: string) {
    super(`Message ${messageId} was already received with a different payload`);
  }
}
