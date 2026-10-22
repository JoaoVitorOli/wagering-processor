import type { EntityManager } from '@mikro-orm/postgresql';
import type { LedgerRepository } from '../../../application/ports/unit-of-work.js';
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
}
