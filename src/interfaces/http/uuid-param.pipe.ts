import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';

export function uuidParam(name: string): ParseUUIDPipe {
  return new ParseUUIDPipe({
    exceptionFactory: () =>
      new BadRequestException({
        code: 'INVALID_PAYLOAD',
        message: `${name} must be a UUID`,
      }),
  });
}
