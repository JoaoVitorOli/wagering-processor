import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CreateWalletUseCase } from '../../../application/wallets/create-wallet.use-case.js';
import { GetWalletUseCase } from '../../../application/wallets/get-wallet.use-case.js';
import { ListLedgerUseCase } from '../../../application/wallets/list-ledger.use-case.js';
import { ReconcileWalletUseCase } from '../../../application/wallets/reconcile-wallet.use-case.js';
import { uuidParam } from '../uuid-param.pipe.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import {
  type CreateWalletRequest,
  createWalletRequestSchema,
} from './create-wallet.request.js';
import { decodeLedgerCursor } from './ledger-cursor.js';
import { type LedgerQuery, ledgerQuerySchema } from './ledger.request.js';
import {
  type LedgerPageResponse,
  toLedgerPageResponse,
} from './ledger.response.js';
import {
  type ReconciliationResponse,
  toReconciliationResponse,
} from './reconciliation.response.js';
import { toWalletResponse, type WalletResponse } from './wallet.response.js';

@Controller('wallets')
export class WalletsController {
  private readonly logger = new Logger(WalletsController.name);

  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
    private readonly listLedger: ListLedgerUseCase,
    private readonly reconcileWallet: ReconcileWalletUseCase,
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
    @Param('walletId', uuidParam('walletId')) walletId: string,
  ): Promise<WalletResponse> {
    return toWalletResponse(await this.getWallet.execute(walletId));
  }

  @Get(':walletId/ledger')
  async ledger(
    @Param('walletId', uuidParam('walletId')) walletId: string,
    @Query(new ZodValidationPipe(ledgerQuerySchema)) query: LedgerQuery,
  ): Promise<LedgerPageResponse> {
    const page = await this.listLedger.execute({
      walletId,
      beforeSequence: query.cursor && decodeLedgerCursor(query.cursor),
      limit: query.limit,
    });
    return toLedgerPageResponse(page);
  }

  @Post(':walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  async reconcile(
    @Param('walletId', uuidParam('walletId')) walletId: string,
  ): Promise<ReconciliationResponse> {
    const reconciliation = await this.reconcileWallet.execute(walletId);
    if (!reconciliation.consistent) {
      this.logger.warn(
        `Wallet ${walletId} is inconsistent: stored ${reconciliation.storedBalance}, ledger ${reconciliation.calculatedBalance}`,
      );
    }
    return toReconciliationResponse(reconciliation);
  }
}
