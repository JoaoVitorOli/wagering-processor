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
import { SubmitBetUseCase } from '../../../application/wagering/submit-bet.use-case.js';
import { WageringController } from './wagering.controller.js';

@Module({
  controllers: [WageringController],
  providers: [
    {
      provide: SubmitBetUseCase,
      useFactory: (unitOfWork: UnitOfWork, ids: IdGenerator, clock: Clock) =>
        new SubmitBetUseCase(unitOfWork, ids, clock),
      inject: [UNIT_OF_WORK, ID_GENERATOR, CLOCK],
    },
  ],
})
export class WageringModule {}
