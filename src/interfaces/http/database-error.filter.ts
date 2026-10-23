import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { DriverException } from '@mikro-orm/core';
import type { Response } from 'express';
import { isTransientDatabaseError } from '../../infra/database/database-errors.js';

const RETRY_AFTER_SECONDS = '1';

@Catch(DriverException)
export class DatabaseErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DatabaseErrorFilter.name);

  catch(error: DriverException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (isTransientDatabaseError(error)) {
      this.logger.warn(error.message);
      response
        .status(HttpStatus.SERVICE_UNAVAILABLE)
        .setHeader('Retry-After', RETRY_AFTER_SECONDS)
        .json({
          code: 'TEMPORARILY_UNAVAILABLE',
          message: 'The request could not be processed now; retry it',
        });
      return;
    }

    this.logger.error(error);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message: 'Unexpected error',
    });
  }
}
