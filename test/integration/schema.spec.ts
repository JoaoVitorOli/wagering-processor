import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { WagerTransactionSchema } from '../../src/infra/database/entities/wager-transaction.entity.js';
import { WalletLedgerEntrySchema } from '../../src/infra/database/entities/wallet-ledger-entry.entity.js';
import { WalletSchema } from '../../src/infra/database/entities/wallet.entity.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../support/test-database.js';

describe('database schema', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase({ checkLedgerOnDrop: false });
  });

  afterAll(async () => {
    await database.drop();
  });

  const em = () => database.orm.em.fork();

  async function insertWallet(overrides: Record<string, unknown> = {}) {
    const row = {
      id: randomUUID(),
      playerId: randomUUID(),
      currency: 'BRL',
      balance: '100.00',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    await em().insert(WalletSchema, row);
    return row;
  }

  async function insertTransaction(overrides: Record<string, unknown> = {}) {
    const walletId =
      (overrides.wallet as string | undefined) ?? (await insertWallet()).id;
    const externalTransactionId = randomUUID();
    const row = {
      id: randomUUID(),
      providerId: 'provider-a',
      externalTransactionId,
      idempotencyKey: `provider-a:${externalTransactionId}`,
      payloadHash: 'hash',
      wallet: walletId,
      playerId: randomUUID(),
      roundId: 'round-1',
      gameId: 'game-1',
      kind: 'BET',
      amount: '10.00',
      currency: 'BRL',
      status: 'PENDING',
      createdAt: new Date(),
      ...overrides,
    };
    await em().insert(WagerTransactionSchema, row as never);
    return row;
  }

  async function insertLedgerEntry(overrides: Record<string, unknown> = {}) {
    const transaction = await insertTransaction();
    const row = {
      id: randomUUID(),
      wallet: transaction.wallet,
      transaction: transaction.id,
      direction: 'DEBIT',
      amount: '10.00',
      balanceBefore: '100.00',
      balanceAfter: '90.00',
      createdAt: new Date(),
      ...overrides,
    };
    await em().insert(WalletLedgerEntrySchema, row as never);
    return row;
  }

  function execute(sql: string, params: unknown[] = []) {
    return database.orm.em.getConnection().execute(sql, params);
  }

  describe('wallets', () => {
    it('accepts a valid wallet', async () => {
      await expect(insertWallet()).resolves.toBeDefined();
    });

    it('rejects a negative balance', async () => {
      await expect(insertWallet({ balance: '-0.01' })).rejects.toMatchObject({
        constraint: 'wallets_balance_check',
      });
    });

    it('rejects a version below 1', async () => {
      await expect(insertWallet({ version: 0 })).rejects.toMatchObject({
        constraint: 'wallets_version_check',
      });
    });

    it('rejects an invalid currency', async () => {
      await expect(insertWallet({ currency: 'brl' })).rejects.toMatchObject({
        constraint: 'wallets_currency_check',
      });
    });

    it('rejects a second wallet for the same player and currency', async () => {
      const wallet = await insertWallet();

      await expect(
        insertWallet({ playerId: wallet.playerId }),
      ).rejects.toMatchObject({
        constraint: 'wallets_player_id_currency_unique',
      });
    });

    it('allows the same player to have wallets in different currencies', async () => {
      const wallet = await insertWallet();

      await expect(
        insertWallet({ playerId: wallet.playerId, currency: 'USD' }),
      ).resolves.toBeDefined();
    });
  });

  describe('wager_transactions', () => {
    it('accepts a valid transaction', async () => {
      await expect(insertTransaction()).resolves.toBeDefined();
    });

    it('rejects a repeated idempotency key', async () => {
      const transaction = await insertTransaction();

      await expect(
        insertTransaction({ idempotencyKey: transaction.idempotencyKey }),
      ).rejects.toMatchObject({
        constraint: 'wager_transactions_idempotency_key_unique',
      });
    });

    it('rejects a repeated external id from the same provider', async () => {
      const transaction = await insertTransaction();

      await expect(
        insertTransaction({
          externalTransactionId: transaction.externalTransactionId,
        }),
      ).rejects.toMatchObject({
        constraint:
          'wager_transactions_provider_id_external_transaction_id_unique',
      });
    });

    it('accepts the same external id from another provider', async () => {
      const transaction = await insertTransaction();

      await expect(
        insertTransaction({
          providerId: 'provider-b',
          externalTransactionId: transaction.externalTransactionId,
        }),
      ).resolves.toBeDefined();
    });

    it('rejects a wallet that does not exist', async () => {
      await expect(
        insertTransaction({ wallet: randomUUID() }),
      ).rejects.toMatchObject({
        constraint: 'wager_transactions_wallet_id_foreign',
      });
    });

    it('rejects an unknown kind', async () => {
      await expect(insertTransaction({ kind: 'BONUS' })).rejects.toMatchObject({
        constraint: 'wager_transactions_kind_check',
      });
    });

    it('rejects an unknown status', async () => {
      await expect(insertTransaction({ status: 'DONE' })).rejects.toMatchObject(
        { constraint: 'wager_transactions_status_check' },
      );
    });

    it('rejects an invalid currency', async () => {
      await expect(insertTransaction({ currency: 'BR' })).rejects.toMatchObject(
        { constraint: 'wager_transactions_currency_check' },
      );
    });

    it('rejects a zero amount outside LOSS', async () => {
      await expect(insertTransaction({ amount: '0.00' })).rejects.toMatchObject(
        { constraint: 'wager_transactions_amount_check' },
      );
    });

    it('accepts a zero amount on LOSS', async () => {
      await expect(
        insertTransaction({ kind: 'LOSS', amount: '0.00' }),
      ).resolves.toBeDefined();
    });

    it('rejects a negative amount on LOSS', async () => {
      await expect(
        insertTransaction({ kind: 'LOSS', amount: '-1.00' }),
      ).rejects.toMatchObject({
        constraint: 'wager_transactions_amount_check',
      });
    });

    it.each(['REFUND', 'ROLLBACK'])(
      'rejects %s without a reference',
      async (kind) => {
        await expect(insertTransaction({ kind })).rejects.toMatchObject({
          constraint: 'wager_transactions_reversal_reference_check',
        });
      },
    );

    it.each(['OPENING', 'BET'])('rejects %s with a reference', async (kind) => {
      await expect(
        insertTransaction({ kind, referenceExternalTransactionId: 'other' }),
      ).rejects.toMatchObject({
        constraint: 'wager_transactions_no_reference_check',
      });
    });

    it('rejects a transaction that references itself', async () => {
      await expect(
        insertTransaction({
          kind: 'WIN',
          externalTransactionId: 'tx-1',
          idempotencyKey: 'provider-a:tx-1',
          referenceExternalTransactionId: 'tx-1',
        }),
      ).rejects.toMatchObject({
        constraint: 'wager_transactions_self_reference_check',
      });
    });

    it('rejects a negative result balance', async () => {
      await expect(
        insertTransaction({
          status: 'PROCESSED',
          resultBalance: '-1.00',
          processedAt: new Date(),
        }),
      ).rejects.toMatchObject({
        constraint: 'wager_transactions_result_balance_check',
      });
    });

    it.each(['REJECTED', 'FAILED'])(
      'rejects %s without a failure code',
      async (status) => {
        await expect(
          insertTransaction({
            status,
            resultBalance: '100.00',
            processedAt: new Date(),
          }),
        ).rejects.toMatchObject({
          constraint: 'wager_transactions_failure_code_check',
        });
      },
    );

    it('rejects a failure code on a processed transaction', async () => {
      await expect(
        insertTransaction({
          status: 'PROCESSED',
          failureCode: 'INSUFFICIENT_FUNDS',
          resultBalance: '90.00',
          processedAt: new Date(),
        }),
      ).rejects.toMatchObject({
        constraint: 'wager_transactions_failure_code_check',
      });
    });

    it('rejects a final status without processed_at', async () => {
      await expect(
        insertTransaction({ status: 'PROCESSED', resultBalance: '90.00' }),
      ).rejects.toMatchObject({
        constraint: 'wager_transactions_processed_at_check',
      });
    });

    it('rejects processed_at on a pending transaction', async () => {
      await expect(
        insertTransaction({ processedAt: new Date() }),
      ).rejects.toMatchObject({
        constraint: 'wager_transactions_processed_at_check',
      });
    });

    it.each(['PENDING_REFERENCE', 'PROCESSED', 'REJECTED'])(
      'rejects %s without a result balance',
      async (status) => {
        await expect(
          insertTransaction({
            status,
            failureCode: status === 'REJECTED' ? 'INSUFFICIENT_FUNDS' : null,
            processedAt: status === 'PENDING_REFERENCE' ? null : new Date(),
            nextReferenceAttemptAt:
              status === 'PENDING_REFERENCE' ? new Date() : null,
          }),
        ).rejects.toMatchObject({
          constraint: 'wager_transactions_result_balance_required_check',
        });
      },
    );

    it('rejects PENDING_REFERENCE without the next attempt scheduled', async () => {
      await expect(
        insertTransaction({
          kind: 'REFUND',
          referenceExternalTransactionId: 'bet-1',
          status: 'PENDING_REFERENCE',
          resultBalance: '100.00',
        }),
      ).rejects.toMatchObject({
        constraint: 'wager_transactions_next_reference_attempt_check',
      });
    });

    it('rejects a next attempt on a transaction that is not waiting', async () => {
      await expect(
        insertTransaction({ nextReferenceAttemptAt: new Date() }),
      ).rejects.toMatchObject({
        constraint: 'wager_transactions_next_reference_attempt_check',
      });
    });

    it('rejects negative reference attempts', async () => {
      await expect(
        insertTransaction({ referenceAttempts: -1 }),
      ).rejects.toMatchObject({
        constraint: 'wager_transactions_reference_attempts_check',
      });
    });

    it('rejects a processed reversal without the resolved reference', async () => {
      await expect(
        insertTransaction({
          kind: 'REFUND',
          referenceExternalTransactionId: 'bet-1',
          status: 'PROCESSED',
          resultBalance: '100.00',
          processedAt: new Date(),
        }),
      ).rejects.toMatchObject({
        constraint: 'wager_transactions_reversal_resolved_check',
      });
    });

    describe('one reversal per reference', () => {
      async function processedReversal(
        reference: {
          id: string;
          externalTransactionId: string;
          wallet: string;
        },
        kind: string,
        status = 'PROCESSED',
      ) {
        return insertTransaction({
          wallet: reference.wallet,
          kind,
          referenceExternalTransactionId: reference.externalTransactionId,
          referenceTransaction: status === 'PROCESSED' ? reference.id : null,
          status,
          failureCode: status === 'REJECTED' ? 'INSUFFICIENT_FUNDS' : null,
          resultBalance: '100.00',
          processedAt: new Date(),
        });
      }

      it('rejects a second processed REFUND of the same transaction', async () => {
        const bet = await insertTransaction();
        await processedReversal(bet, 'REFUND');

        await expect(processedReversal(bet, 'REFUND')).rejects.toMatchObject({
          constraint: 'wager_transactions_one_reversal_per_reference',
        });
      });

      it('rejects a ROLLBACK of a transaction that already has a REFUND', async () => {
        const bet = await insertTransaction();
        await processedReversal(bet, 'REFUND');

        await expect(processedReversal(bet, 'ROLLBACK')).rejects.toMatchObject({
          constraint: 'wager_transactions_one_reversal_per_reference',
        });
      });

      it('ignores rejected reversals', async () => {
        const bet = await insertTransaction();
        await processedReversal(bet, 'REFUND', 'REJECTED');
        await processedReversal(bet, 'REFUND');

        await expect(
          processedReversal(bet, 'REFUND', 'REJECTED'),
        ).resolves.toBeDefined();
      });
    });
  });

  describe('wallet_ledger_entries', () => {
    it('accepts a valid entry and numbers it', async () => {
      const entry = await insertLedgerEntry();

      const [row] = await execute(
        'select sequence from wallet_ledger_entries where id = ?',
        [entry.id],
      );

      expect(Number(row.sequence)).toBeGreaterThan(0);
    });

    it('rejects a non-positive amount', async () => {
      await expect(
        insertLedgerEntry({
          amount: '0.00',
          balanceBefore: '100.00',
          balanceAfter: '100.00',
        }),
      ).rejects.toMatchObject({
        constraint: 'wallet_ledger_entries_amount_check',
      });
    });

    it('rejects a negative balance after', async () => {
      await expect(
        insertLedgerEntry({
          amount: '10.00',
          balanceBefore: '5.00',
          balanceAfter: '-5.00',
        }),
      ).rejects.toMatchObject({
        constraint: 'wallet_ledger_entries_balance_after_check',
      });
    });

    it('rejects an unbalanced entry', async () => {
      await expect(
        insertLedgerEntry({ balanceAfter: '91.00' }),
      ).rejects.toMatchObject({
        constraint: 'wallet_ledger_entries_balanced_check',
      });
    });

    it('rejects an unknown direction', async () => {
      await expect(
        insertLedgerEntry({ direction: 'SIDEWAYS' }),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('rejects a second entry for the same transaction', async () => {
      const entry = await insertLedgerEntry();

      await expect(
        em().insert(WalletLedgerEntrySchema, {
          ...entry,
          id: randomUUID(),
        } as never),
      ).rejects.toMatchObject({
        constraint: 'wallet_ledger_entries_wallet_id_transaction_id_unique',
      });
    });

    it('rejects updates', async () => {
      const entry = await insertLedgerEntry();

      await expect(
        execute(
          "update wallet_ledger_entries set amount = '1.00' where id = ?",
          [entry.id],
        ),
      ).rejects.toThrow('wallet_ledger_entries is append-only');
    });

    it('rejects deletes', async () => {
      const entry = await insertLedgerEntry();

      await expect(
        execute('delete from wallet_ledger_entries where id = ?', [entry.id]),
      ).rejects.toThrow('wallet_ledger_entries is append-only');
    });

    it('rejects truncate', async () => {
      await expect(
        execute('truncate wallet_ledger_entries cascade'),
      ).rejects.toThrow('wallet_ledger_entries is append-only');
    });
  });
});
