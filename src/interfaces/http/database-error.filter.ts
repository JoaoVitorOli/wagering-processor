import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { DriverException } from '@mikro-orm/core';
import type { Response } from 'express';
import {
  isLockConflict,
  isTransientDatabaseError,
} from '../../infra/database/database-errors.js';
import { METRICS, type Metrics } from '../../infra/observability/metrics.js';

const RETRY_AFTER_SECONDS = '1';

@Catch(DriverException)
export class DatabaseErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DatabaseErrorFilter.name);

  constructor(@Inject(METRICS) private readonly metrics: Metrics) {}

  catch(error: DriverException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (isLockConflict(error)) {
      this.metrics.lockConflicts.inc({ source: 'http' });
    }
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
