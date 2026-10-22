import { defineEntity, type InferEntity, p } from '@mikro-orm/core';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction.js';
import { WalletSchema } from './wallet.entity.js';

export const WagerTransactionSchema = defineEntity({
  name: 'WagerTransaction',
  tableName: 'wager_transactions',
  properties: {
    id: p.uuid().primary(),
    providerId: p.string(),
    externalTransactionId: p.string(),
    idempotencyKey: p.string().unique(),
    payloadHash: p.string(),
    wallet: () => p.manyToOne(WalletSchema),
    playerId: p.uuid(),
    roundId: p.string(),
    gameId: p.string(),
    kind: p.enum(() => WagerTransactionKind),
    amount: p.decimal('string').precision(18).scale(2),
    currency: p.string().columnType('char(3)'),
    referenceExternalTransactionId: p.string().nullable(),
    referenceTransaction: () =>
      p.manyToOne(WagerTransactionSchema).nullable().deleteRule('no action'),
    status: p.enum(() => WagerTransactionStatus),
    failureCode: p.string().nullable(),
    resultBalance: p.decimal('string').precision(18).scale(2).nullable(),
    createdAt: p.datetime(),
    processedAt: p.datetime().nullable(),
  },
  uniques: [
    { properties: ['providerId', 'externalTransactionId'] },
    {
      name: 'wager_transactions_one_reversal_per_kind',
      properties: ['referenceTransaction', 'kind'],
      where: "status = 'PROCESSED' and kind in ('REFUND', 'ROLLBACK')",
    },
  ],
  checks: [
    {
      name: 'wager_transactions_currency_check',
      expression: "currency ~ '^[A-Z]{3}$'",
    },
    {
      name: 'wager_transactions_amount_check',
      expression: "amount > 0 or (kind = 'LOSS' and amount = 0)",
    },
    {
      name: 'wager_transactions_result_balance_check',
      expression: 'result_balance >= 0',
    },
    {
      name: 'wager_transactions_reversal_reference_check',
      expression:
        "kind not in ('REFUND', 'ROLLBACK') or reference_external_transaction_id is not null",
    },
    {
      name: 'wager_transactions_no_reference_check',
      expression:
        "kind not in ('OPENING', 'BET') or reference_external_transaction_id is null",
    },
    {
      name: 'wager_transactions_self_reference_check',
      expression:
        'reference_external_transaction_id <> external_transaction_id',
    },
    {
      name: 'wager_transactions_failure_code_check',
      expression:
        "(status in ('REJECTED', 'FAILED')) = (failure_code is not null)",
    },
    {
      name: 'wager_transactions_processed_at_check',
      expression:
        "(status in ('PROCESSED', 'REJECTED', 'FAILED')) = (processed_at is not null)",
    },
    {
      name: 'wager_transactions_result_balance_required_check',
      expression:
        "status not in ('PENDING_REFERENCE', 'PROCESSED', 'REJECTED') or result_balance is not null",
    },
    {
      name: 'wager_transactions_reversal_resolved_check',
      expression:
        "status <> 'PROCESSED' or kind not in ('REFUND', 'ROLLBACK') or reference_transaction_id is not null",
    },
  ],
});

export type WagerTransactionRecord = InferEntity<typeof WagerTransactionSchema>;
