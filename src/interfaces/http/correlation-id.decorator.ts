import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestWithContext } from './request-context.middleware.js';

export const CorrelationId = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<RequestWithContext>().correlationId,
);
