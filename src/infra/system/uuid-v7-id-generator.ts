import type { IdGenerator } from '../../application/ports/id-generator.js';

export class UuidV7IdGenerator implements IdGenerator {
  next(): string {
    return Bun.randomUUIDv7();
  }
}