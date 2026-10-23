import { BadRequestException } from '@nestjs/common';

const SEQUENCE_PATTERN = /^[1-9][0-9]*$/;

export function encodeLedgerCursor(sequence: string): string {
  return Buffer.from(JSON.stringify({ sequence })).toString('base64url');
}

export function decodeLedgerCursor(cursor: string): string {
  try {
    const { sequence } = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { sequence?: unknown };
    if (typeof sequence === 'string' && SEQUENCE_PATTERN.test(sequence)) {
      return sequence;
    }
  } catch {}
  throw new BadRequestException({
    code: 'INVALID_CURSOR',
    message: 'The cursor is not valid',
  });
}
