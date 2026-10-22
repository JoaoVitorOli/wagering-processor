import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SubmitBetUseCase } from '../../../application/wagering/submit-bet.use-case.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { IdempotencyKey } from './idempotency-key.decorator.js';
import {
  idempotencyKeySchema,
  type SubmitTransactionRequest,
  submitTransactionRequestSchema,
} from './submit-transaction.request.js';
import {
  httpStatusFor,
  type TransactionResponse,
  toTransactionResponse,
} from './transaction.response.js';

@Controller('wagering/transactions')
export class WageringController {
  constructor(private readonly submitBet: SubmitBetUseCase) {}

  @Post()
  async submit(
    @IdempotencyKey(new ZodValidationPipe(idempotencyKeySchema))
    idempotencyKey: string,
    @Body(new ZodValidationPipe(submitTransactionRequestSchema))
    body: SubmitTransactionRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TransactionResponse> {
    const { transaction, idempotentReplay } = await this.submitBet.execute({
      idempotencyKey,
      ...body,
    });
    response.status(httpStatusFor(transaction));
    return toTransactionResponse(transaction, idempotentReplay);
  }
}
