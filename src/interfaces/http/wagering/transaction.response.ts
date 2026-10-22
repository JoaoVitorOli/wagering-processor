import { HttpStatus } from '@nestjs/common';
import type { MoneyProps } from '../../../domain/money/money.js';
import {
  type WagerTransaction,
  WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction.js';

export interface TransactionResponse {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps | null;
  failureCode?: string;
  idempotentReplay: boolean;
}

const STATUS_BY_TRANSACTION_STATUS: Record<WagerTransactionStatus, HttpStatus> =
  {
    [WagerTransactionStatus.Pending]: HttpStatus.INTERNAL_SERVER_ERROR,
    [WagerTransactionStatus.PendingReference]: HttpStatus.ACCEPTED,
    [WagerTransactionStatus.Processed]: HttpStatus.OK,
    [WagerTransactionStatus.Rejected]: HttpStatus.UNPROCESSABLE_ENTITY,
    [WagerTransactionStatus.Failed]: HttpStatus.INTERNAL_SERVER_ERROR,
  };

export function httpStatusFor(transaction: WagerTransaction): HttpStatus {
  return STATUS_BY_TRANSACTION_STATUS[transaction.status];
}

export function toTransactionResponse(
  transaction: WagerTransaction,
  idempotentReplay: boolean,
): TransactionResponse {
  return {
    transactionId: transaction.id,
    status: transaction.status,
    balance: transaction.resultBalance?.toJSON() ?? null,
    ...(transaction.failureCode && { failureCode: transaction.failureCode }),
    idempotentReplay,
  };
}
