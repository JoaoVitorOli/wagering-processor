import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CreateWalletUseCase } from '../../../application/wallets/create-wallet.use-case.js';
import { GetWalletUseCase } from '../../../application/wallets/get-wallet.use-case.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import {
  type CreateWalletRequest,
  createWalletRequestSchema,
} from './create-wallet.request.js';
import { toWalletResponse, type WalletResponse } from './wallet.response.js';

const walletIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_PAYLOAD',
      message: 'walletId must be a UUID',
    }),
});

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
  ) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(createWalletRequestSchema))
    body: CreateWalletRequest,
  ): Promise<WalletResponse> {
    return toWalletResponse(await this.createWallet.execute(body));
  }

  @Get(':walletId')
  async findOne(
    @Param('walletId', walletIdPipe) walletId: string,
  ): Promise<WalletResponse> {
    return toWalletResponse(await this.getWallet.execute(walletId));
  }
}
