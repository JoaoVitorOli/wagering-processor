import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export const CORRELATION_HEADER = 'x-correlation-id';
const CORRELATION_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export interface RequestWithContext extends Request {
  correlationId: string;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(request: Request, response: Response, next: NextFunction): void {
    const received = request.header(CORRELATION_HEADER);
    const correlationId =
      received && CORRELATION_PATTERN.test(received) ? received : randomUUID();
    (request as RequestWithContext).correlationId = correlationId;
    response.setHeader(CORRELATION_HEADER, correlationId);

    const startedAt = performance.now();
    response.on('finish', () => {
      this.logger.log({
        event: 'http.request',
        correlationId,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
    next();
  }
}
