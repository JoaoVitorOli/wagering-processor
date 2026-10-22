import { defineEntity, type InferEntity, p } from '@mikro-orm/core';

export const WalletSchema = defineEntity({
  name: 'Wallet',
  tableName: 'wallets',
  properties: {
    id: p.uuid().primary(),
    playerId: p.uuid(),
    currency: p.string().columnType('char(3)'),
    balance: p.decimal('string').precision(18).scale(2),
    version: p.integer(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
  uniques: [{ properties: ['playerId', 'currency'] }],
  checks: [
    { name: 'wallets_currency_check', expression: "currency ~ '^[A-Z]{3}$'" },
    { name: 'wallets_balance_check', expression: 'balance >= 0' },
    { name: 'wallets_version_check', expression: 'version >= 1' },
  ],
});

export type WalletRecord = InferEntity<typeof WalletSchema>;
