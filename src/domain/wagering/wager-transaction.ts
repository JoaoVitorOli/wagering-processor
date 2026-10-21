import type { Money } from '../money/money.js';
import { LedgerDirection } from '../wallet/wallet-ledger-entry.js';
import type { FailureCode } from './failure-code.js';
import {
  InvalidTransactionStateError,
  InvalidWagerTransactionError,
} from './wager-transaction.errors.js';

export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

const ALLOWED_TRANSITIONS: Record<
  WagerTransactionStatus,
  readonly WagerTransactionStatus[]
> = {
  [WagerTransactionStatus.Pending]: [
    WagerTransactionStatus.PendingReference,
    WagerTransactionStatus.Processed,
    WagerTransactionStatus.Rejected,
    WagerTransactionStatus.Failed,
  ],
  [WagerTransactionStatus.PendingReference]: [
    WagerTransactionStatus.Processed,
    WagerTransactionStatus.Rejected,
    WagerTransactionStatus.Failed,
  ],
  [WagerTransactionStatus.Processed]: [],
  [WagerTransactionStatus.Rejected]: [],
  [WagerTransactionStatus.Failed]: [],
};

const REVERSAL_KINDS = [
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
];
const KINDS_WITHOUT_REFERENCE = [
  WagerTransactionKind.Opening,
  WagerTransactionKind.Bet,
];

export const INTERNAL_PROVIDER_ID = 'internal';

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
}

export interface OpeningTransactionProps {
  id: string;
  walletId: string;
  playerId: string;
  money: Money;
  at: Date;
}

export interface WagerTransactionState extends CreateWagerTransactionProps {
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  resultBalance?: Money;
  processedAt?: Date;
}

export class WagerTransaction {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: Money;
  readonly referenceExternalTransactionId: string | undefined;
  readonly createdAt: Date;
  private _status: WagerTransactionStatus;
  private _referenceTransactionId: string | undefined;
  private _failureCode: FailureCode | undefined;
  private _resultBalance: Money | undefined;
  private _processedAt: Date | undefined;

  private constructor(state: WagerTransactionState) {
    this.id = state.id;
    this.providerId = state.providerId;
    this.externalTransactionId = state.externalTransactionId;
    this.idempotencyKey = state.idempotencyKey;
    this.payloadHash = state.payloadHash;
    this.walletId = state.walletId;
    this.playerId = state.playerId;
    this.roundId = state.roundId;
    this.gameId = state.gameId;
    this.kind = state.kind;
    this.money = state.money;
    this.referenceExternalTransactionId = state.referenceExternalTransactionId;
    this.createdAt = state.createdAt;
    this._status = state.status;
    this._referenceTransactionId = state.referenceTransactionId;
    this._failureCode = state.failureCode;
    this._resultBalance = state.resultBalance;
    this._processedAt = state.processedAt;
  }

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (props.kind === WagerTransactionKind.Opening) {
      throw new InvalidWagerTransactionError(
        'OPENING is internal and cannot be submitted',
      );
    }
    WagerTransaction.assertValidReference(props);
    WagerTransaction.assertValidAmount(props);

    return new WagerTransaction({
      ...props,
      status: WagerTransactionStatus.Pending,
    });
  }

  static opening(props: OpeningTransactionProps): WagerTransaction {
    return new WagerTransaction({
      id: props.id,
      providerId: INTERNAL_PROVIDER_ID,
      externalTransactionId: `opening:${props.walletId}`,
      idempotencyKey: `${INTERNAL_PROVIDER_ID}:opening:${props.walletId}`,
      payloadHash: `opening:${props.walletId}`,
      walletId: props.walletId,
      playerId: props.playerId,
      roundId: 'opening',
      gameId: 'opening',
      kind: WagerTransactionKind.Opening,
      money: props.money,
      createdAt: props.at,
      status: WagerTransactionStatus.Processed,
      resultBalance: props.money,
      processedAt: props.at,
    });
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(state);
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get resultBalance(): Money | undefined {
    return this._resultBalance;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  markProcessed(props: {
    resultBalance: Money;
    referenceTransactionId?: string;
    at: Date;
  }): void {
    this.transitionTo(WagerTransactionStatus.Processed);
    this._referenceTransactionId = props.referenceTransactionId;
    this._resultBalance = props.resultBalance;
    this._processedAt = props.at;
  }

  markPendingReference(props: { resultBalance: Money }): void {
    this.transitionTo(WagerTransactionStatus.PendingReference);
    this._resultBalance = props.resultBalance;
  }

  reject(props: { code: FailureCode; resultBalance: Money; at: Date }): void {
    this.transitionTo(WagerTransactionStatus.Rejected);
    this._failureCode = props.code;
    this._resultBalance = props.resultBalance;
    this._processedAt = props.at;
  }

  fail(props: { code: FailureCode; at: Date }): void {
    this.transitionTo(WagerTransactionStatus.Failed);
    this._failureCode = props.code;
    this._processedAt = props.at;
  }

  isTerminal(): boolean {
    return ALLOWED_TRANSITIONS[this._status].length === 0;
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return REVERSAL_KINDS.includes(this.kind);
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Rollback:
        if (!reference) {
          throw new InvalidWagerTransactionError(
            'ROLLBACK needs its reference to know the ledger direction',
          );
        }
        return reference.ledgerDirectionFor() === LedgerDirection.Credit
          ? LedgerDirection.Debit
          : LedgerDirection.Credit;
      case WagerTransactionKind.Loss:
        throw new InvalidWagerTransactionError(
          'LOSS does not move the balance',
        );
    }
  }

  private transitionTo(next: WagerTransactionStatus): void {
    if (!ALLOWED_TRANSITIONS[this._status].includes(next)) {
      throw new InvalidTransactionStateError(
        `Transaction ${this.id} cannot go from ${this._status} to ${next}`,
      );
    }
    this._status = next;
  }

  private static assertValidReference(
    props: CreateWagerTransactionProps,
  ): void {
    const reference = props.referenceExternalTransactionId;

    if (REVERSAL_KINDS.includes(props.kind) && !reference) {
      throw new InvalidWagerTransactionError(
        `${props.kind} requires referenceExternalTransactionId`,
      );
    }
    if (KINDS_WITHOUT_REFERENCE.includes(props.kind) && reference) {
      throw new InvalidWagerTransactionError(
        `${props.kind} cannot reference another transaction`,
      );
    }
    if (reference === props.externalTransactionId) {
      throw new InvalidWagerTransactionError(
        'A transaction cannot reference itself',
      );
    }
  }

  private static assertValidAmount(props: CreateWagerTransactionProps): void {
    const allowsZero = props.kind === WagerTransactionKind.Loss;
    if (!props.money.isPositive() && !(allowsZero && props.money.isZero())) {
      throw new InvalidWagerTransactionError(
        `${props.kind} amount must be positive, got ${props.money}`,
      );
    }
  }
}
