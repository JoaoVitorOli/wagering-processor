import { Global, Module } from '@nestjs/common';
import { CLOCK } from '../../application/ports/clock.js';
import { ID_GENERATOR } from '../../application/ports/id-generator.js';
import { SystemClock } from './system-clock.js';
import { UuidV7IdGenerator } from './uuid-v7-id-generator.js';

@Global()
@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidV7IdGenerator },
  ],
  exports: [CLOCK, ID_GENERATOR],
})
export class SystemModule {}