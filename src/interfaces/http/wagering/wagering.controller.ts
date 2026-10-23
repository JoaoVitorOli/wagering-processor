import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GetTransactionUseCase } from '../../../application/wagering/get-transaction.use-case.js';
import { SubmitWagerTransactionUseCase } from '../../../application/wagering/submit-wager-transaction.use-case.js';
import { uuidParam } from '../uuid-param.pipe.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { IdempotencyKey } from './idempotency-key.decorator.js';
import {
  idempotencyKeySchema,
  type SubmitTransactionRequest,
  submitTransactionRequestSchema,
} from './submit-transaction.request.js';
import {
  type TransactionDetailsResponse,
  toTransactionDetailsResponse,
} from './transaction-details.response.js';
import {
  httpStatusFor,
  type TransactionResponse,
  toTransactionResponse,
} from './transaction.response.js';

@Controller('wagering/transactions')
export class WageringController {
  constructor(
    private readonly submitTransaction: SubmitWagerTransactionUseCase,
    private readonly getTransaction: GetTransactionUseCase,
  ) {}

  @Get(':transactionId')
  async findOne(
    @Param('transactionId', uuidParam('transactionId')) transactionId: string,
  ): Promise<TransactionDetailsResponse> {
    return toTransactionDetailsResponse(
      await this.getTransaction.byId(transactionId),
    );
  }

  @Post()
  async submit(
    @IdempotencyKey(new ZodValidationPipe(idempotencyKeySchema))
    idempotencyKey: string,
    @Body(new ZodValidationPipe(submitTransactionRequestSchema))
    body: SubmitTransactionRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TransactionResponse> {
    const { transaction, idempotentReplay } =
      await this.submitTransaction.execute({
        idempotencyKey,
        ...body,
      });
    response.status(httpStatusFor(transaction));
    return toTransactionResponse(transaction, idempotentReplay);
  }
}
