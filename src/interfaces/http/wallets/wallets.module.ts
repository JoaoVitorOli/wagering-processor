import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../application/ports/clock.js';
import {
  ID_GENERATOR,
  type IdGenerator,
} from '../../../application/ports/id-generator.js';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from '../../../application/ports/unit-of-work.js';
import { CreateWalletUseCase } from '../../../application/wallets/create-wallet.use-case.js';
import { GetWalletUseCase } from '../../../application/wallets/get-wallet.use-case.js';
import { ListLedgerUseCase } from '../../../application/wallets/list-ledger.use-case.js';
import { ReconcileWalletUseCase } from '../../../application/wallets/reconcile-wallet.use-case.js';
import { WalletsController } from './wallets.controller.js';

@Module({
  controllers: [WalletsController],
  providers: [
    {
      provide: CreateWalletUseCase,
      useFactory: (unitOfWork: UnitOfWork, ids: IdGenerator, clock: Clock) =>
        new CreateWalletUseCase(unitOfWork, ids, clock),
      inject: [UNIT_OF_WORK, ID_GENERATOR, CLOCK],
    },
    {
      provide: GetWalletUseCase,
      useFactory: (unitOfWork: UnitOfWork) => new GetWalletUseCase(unitOfWork),
      inject: [UNIT_OF_WORK],
    },
    {
      provide: ListLedgerUseCase,
      useFactory: (unitOfWork: UnitOfWork) => new ListLedgerUseCase(unitOfWork),
      inject: [UNIT_OF_WORK],
    },
    {
      provide: ReconcileWalletUseCase,
      useFactory: (unitOfWork: UnitOfWork) =>
        new ReconcileWalletUseCase(unitOfWork),
      inject: [UNIT_OF_WORK],
    },
  ],
})
export class WalletsModule {}
