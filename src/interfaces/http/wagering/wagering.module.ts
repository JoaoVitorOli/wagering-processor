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
import {
  REFERENCE_RETRY_POLICY,
  type ReferenceRetryPolicy,
} from '../../../application/wagering/reference-retry-policy.js';
import { GetTransactionUseCase } from '../../../application/wagering/get-transaction.use-case.js';
import { SubmitWagerTransactionUseCase } from '../../../application/wagering/submit-wager-transaction.use-case.js';
import { ProviderTransactionsController } from './provider-transactions.controller.js';
import { WageringController } from './wagering.controller.js';

@Module({
  controllers: [WageringController, ProviderTransactionsController],
  providers: [
    {
      provide: SubmitWagerTransactionUseCase,
      useFactory: (
        unitOfWork: UnitOfWork,
        ids: IdGenerator,
        clock: Clock,
        policy: ReferenceRetryPolicy,
      ) => new SubmitWagerTransactionUseCase(unitOfWork, ids, clock, policy),
      inject: [UNIT_OF_WORK, ID_GENERATOR, CLOCK, REFERENCE_RETRY_POLICY],
    },
    {
      provide: GetTransactionUseCase,
      useFactory: (unitOfWork: UnitOfWork) =>
        new GetTransactionUseCase(unitOfWork),
      inject: [UNIT_OF_WORK],
    },
  ],
  exports: [SubmitWagerTransactionUseCase],
})
export class WageringModule {}
