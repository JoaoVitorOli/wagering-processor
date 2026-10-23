import type { SQSClient } from '@aws-sdk/client-sqs';
import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createSqsClient, SQS_CLIENT } from './sqs-client.js';

@Global()
@Module({
  providers: [{ provide: SQS_CLIENT, useFactory: createSqsClient }],
  exports: [SQS_CLIENT],
})
export class MessagingModule implements OnApplicationShutdown {
  constructor(@Inject(SQS_CLIENT) private readonly client: SQSClient) {}

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
