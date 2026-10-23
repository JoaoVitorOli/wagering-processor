import { Global, Module } from '@nestjs/common';
import {
  DEFAULT_REFERENCE_RETRY_POLICY,
  REFERENCE_RETRY_POLICY,
} from '../application/wagering/reference-retry-policy.js';

@Global()
@Module({
  providers: [
    {
      provide: REFERENCE_RETRY_POLICY,
      useValue: DEFAULT_REFERENCE_RETRY_POLICY,
    },
  ],
  exports: [REFERENCE_RETRY_POLICY],
})
export class PoliciesModule {}
