import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  LedgerPageItem,
  LedgerRepository,
  LedgerTotals,
} from '../../../application/ports/unit-of-work.js';
import type { WalletLedgerEntry } from '../../../domain/wallet/wallet-ledger-entry.js';
import { WalletLedgerEntrySchema } from '../entities/wallet-ledger-entry.entity.js';
import { WalletLedgerEntryMapper } from '../mappers/wallet-ledger-entry.mapper.js';

export class MikroOrmLedgerRepository implements LedgerRepository {
  constructor(private readonly em: EntityManager) {}

  async add(entry: WalletLedgerEntry): Promise<void> {
    await this.em.insert(
      WalletLedgerEntrySchema,
      WalletLedgerEntryMapper.toRecord(entry),
    );
  }

  async findPage(
    walletId: string,
    beforeSequence: string | undefined,
    limit: number,
  ): Promise<LedgerPageItem[]> {
    const records = await this.em.find(
      WalletLedgerEntrySchema,
      {
        wallet: walletId,
        ...(beforeSequence && { sequence: { $lt: beforeSequence } }),
      },
      { populate: ['wallet'], orderBy: { sequence: 'desc' }, limit },
    );
    return records.map((record) => ({
      entry: WalletLedgerEntryMapper.toDomain(record),
      sequence: record.sequence,
    }));
  }

  async totals(walletId: string): Promise<LedgerTotals> {
    const [row] = await this.em.execute<
      { credits: string; debits: string; entries: string }[]
    >(
      `select coalesce(sum(amount) filter (where direction = 'CREDIT'), 0) as credits,
              coalesce(sum(amount) filter (where direction = 'DEBIT'), 0) as debits,
              count(*) as entries
         from wallet_ledger_entries
        where wallet_id = ?`,
      [walletId],
    );
    return {
      credits: String(row.credits),
      debits: String(row.debits),
      entries: Number(row.entries),
    };
  }
}
