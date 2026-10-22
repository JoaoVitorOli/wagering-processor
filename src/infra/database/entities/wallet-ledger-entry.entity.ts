import { defineEntity, type InferEntity, p } from '@mikro-orm/core';
import { LedgerDirection } from '../../../domain/wallet/wallet-ledger-entry.js';
import { WagerTransactionSchema } from './wager-transaction.entity.js';
import { WalletSchema } from './wallet.entity.js';

export const WalletLedgerEntrySchema = defineEntity({
  name: 'WalletLedgerEntry',
  tableName: 'wallet_ledger_entries',
  properties: {
    id: p.uuid().primary(),
    sequence: p.bigint('string').autoincrement().unique(),
    wallet: () => p.manyToOne(WalletSchema),
    transaction: () => p.manyToOne(WagerTransactionSchema),
    direction: p.enum(() => LedgerDirection),
    amount: p.decimal('string').precision(18).scale(2),
    balanceBefore: p.decimal('string').precision(18).scale(2),
    balanceAfter: p.decimal('string').precision(18).scale(2),
    createdAt: p.datetime(),
  },
  uniques: [{ properties: ['wallet', 'transaction'] }],
  indexes: [{ properties: ['wallet', 'sequence'] }],
  checks: [
    { name: 'wallet_ledger_entries_amount_check', expression: 'amount > 0' },
    {
      name: 'wallet_ledger_entries_balance_before_check',
      expression: 'balance_before >= 0',
    },
    {
      name: 'wallet_ledger_entries_balance_after_check',
      expression: 'balance_after >= 0',
    },
    {
      name: 'wallet_ledger_entries_balanced_check',
      expression:
        "(direction = 'CREDIT' and balance_after = balance_before + amount) or (direction = 'DEBIT' and balance_after = balance_before - amount)",
    },
  ],
  triggers: [
    {
      name: 'prevent_update_delete',
      timing: 'before',
      events: ['update', 'delete'],
      forEach: 'row',
      body: "raise exception 'wallet_ledger_entries is append-only'; return null;",
    },
  ],
});

export type WalletLedgerEntryRecord = InferEntity<
  typeof WalletLedgerEntrySchema
>;
