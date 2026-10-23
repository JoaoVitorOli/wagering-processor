import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { GetTransactionUseCase } from '../../../application/wagering/get-transaction.use-case.js';
import {
  type TransactionDetailsResponse,
  toTransactionDetailsResponse,
} from './transaction-details.response.js';
import { ProviderAuthGuard } from '../provider-auth.guard.js';

@Controller('providers/:providerId/wagering/transactions')
@UseGuards(ProviderAuthGuard)
export class ProviderTransactionsController {
  constructor(private readonly getTransaction: GetTransactionUseCase) {}

  @Get(':externalTransactionId')
  async findOne(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ): Promise<TransactionDetailsResponse> {
    return toTransactionDetailsResponse(
      await this.getTransaction.byExternalId(providerId, externalTransactionId),
    );
  }
}
