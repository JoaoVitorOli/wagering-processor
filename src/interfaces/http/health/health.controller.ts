import { ListQueuesCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { EntityManager } from '@mikro-orm/postgresql';
import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SQS_CLIENT } from '../../../infra/messaging/sqs-client.js';

const CHECK_TIMEOUT_MS = 2_000;

type CheckStatus = 'up' | 'down';

@Controller('health')
export class HealthController {
  constructor(
    private readonly em: EntityManager,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const [database, sqs] = await Promise.all([
      this.check(() => this.em.fork().getConnection().execute('select 1')),
      this.check(() =>
        this.sqs.send(new ListQueuesCommand({ MaxResults: 1 }), {
          abortSignal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        }),
      ),
    ]);
    const ready = database === 'up' && sqs === 'up';
    response.status(ready ? 200 : 503);
    return { status: ready ? 'ok' : 'unavailable', checks: { database, sqs } };
  }

  private async check(probe: () => Promise<unknown>): Promise<CheckStatus> {
    try {
      await Promise.race([
        probe(),
        Bun.sleep(CHECK_TIMEOUT_MS).then(() => {
          throw new Error('timed out');
        }),
      ]);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
