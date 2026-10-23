import {
  type EntityManager,
  LockMode,
  UniqueConstraintViolationException,
} from '@mikro-orm/postgresql';
import { WalletAlreadyExistsError } from '../../../application/wallets/wallet.errors.js';
import type { WalletRepository } from '../../../application/ports/unit-of-work.js';
import type { Wallet } from '../../../domain/wallet/wallet.js';
import { WalletSchema } from '../entities/wallet.entity.js';
import { WalletMapper } from '../mappers/wallet.mapper.js';

const ONE_WALLET_PER_CURRENCY = 'wallets_player_id_currency_unique';

export class ConcurrentWalletUpdateError extends Error {
  constructor(walletId: string) {
    super(`Wallet ${walletId} changed while it was locked`);
  }
}

export class MikroOrmWalletRepository implements WalletRepository {
  constructor(private readonly em: EntityManager) {}

  async add(wallet: Wallet): Promise<void> {
    try {
      await this.em.insert(WalletSchema, WalletMapper.toRecord(wallet));
    } catch (error) {
      if (violates(error, ONE_WALLET_PER_CURRENCY)) {
        throw new WalletAlreadyExistsError(wallet.playerId, wallet.currency);
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Wallet | undefined> {
    const record = await this.em.findOne(WalletSchema, { id });
    return record ? WalletMapper.toDomain(record) : undefined;
  }

  async findByIdForUpdate(id: string): Promise<Wallet | undefined> {
    const record = await this.em.findOne(
      WalletSchema,
      { id },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    return record ? WalletMapper.toDomain(record) : undefined;
  }

  async findByIdForShare(id: string): Promise<Wallet | undefined> {
    const record = await this.em.findOne(
      WalletSchema,
      { id },
      { lockMode: LockMode.PESSIMISTIC_READ },
    );
    return record ? WalletMapper.toDomain(record) : undefined;
  }

  async update(wallet: Wallet, expectedVersion: number): Promise<void> {
    const updated = await this.em.nativeUpdate(
      WalletSchema,
      { id: wallet.id, version: expectedVersion },
      {
        balance: wallet.balance.toJSON().amount,
        version: wallet.version,
        updatedAt: wallet.updatedAt,
      },
    );
    if (updated !== 1) {
      throw new ConcurrentWalletUpdateError(wallet.id);
    }
  }
}

function violates(error: unknown, constraint: string): boolean {
  return (
    error instanceof UniqueConstraintViolationException &&
    (error as { constraint?: string }).constraint === constraint
  );
}
