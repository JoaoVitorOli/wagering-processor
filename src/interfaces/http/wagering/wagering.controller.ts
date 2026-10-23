import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { GetTransactionUseCase } from '../../../application/wagering/get-transaction.use-case.js';
import { METRICS, type Metrics } from '../../../infra/observability/metrics.js';
import { CorrelationId } from '../correlation-id.decorator.js';
import { ProviderAuthGuard } from '../provider-auth.guard.js';
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
@UseGuards(ProviderAuthGuard)
export class WageringController {
  private readonly logger = new Logger(WageringController.name);

  constructor(
    private readonly submitTransaction: SubmitWagerTransactionUseCase,
    private readonly getTransaction: GetTransactionUseCase,
    @Inject(METRICS) private readonly metrics: Metrics,
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
    @CorrelationId() correlationId: string,
  ): Promise<TransactionResponse> {
    const stopTimer = this.metrics.processingSeconds.startTimer({
      source: 'http',
    });
    const { transaction, idempotentReplay } =
      await this.submitTransaction.execute({
        idempotencyKey,
        ...body,
        trace: { correlationId },
      });
    stopTimer();
    if (idempotentReplay) {
      this.metrics.duplicates.inc({ source: 'http' });
    } else {
      this.metrics.transactions.inc({
        source: 'http',
        kind: transaction.kind,
        status: transaction.status,
      });
    }
    this.logger.log({
      event: 'wager_transaction.submitted',
      correlationId,
      transactionId: transaction.id,
      walletId: transaction.walletId,
      providerId: transaction.providerId,
      kind: transaction.kind,
      status: transaction.status,
      failureCode: transaction.failureCode,
      idempotentReplay,
    });
    response.status(httpStatusFor(transaction));
    return toTransactionResponse(transaction, idempotentReplay);
  }
}
