import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../../domain/shared/domain-error.js';

const STATUS_BY_CODE: Record<string, HttpStatus> = {
  INVALID_MONEY: HttpStatus.BAD_REQUEST,
  INVALID_MOVEMENT_AMOUNT: HttpStatus.BAD_REQUEST,
  WALLET_NOT_FOUND: HttpStatus.NOT_FOUND,
  WALLET_ALREADY_EXISTS: HttpStatus.CONFLICT,
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  EXTERNAL_TRANSACTION_CONFLICT: HttpStatus.CONFLICT,
};

@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainErrorFilter.name);

  catch(error: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = STATUS_BY_CODE[error.code];

    if (status === undefined) {
      this.logger.error(error);
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        code: 'INTERNAL_ERROR',
        message: 'Unexpected error',
      });
      return;
    }

    response.status(status).json({ code: error.code, message: error.message });
  }
}
