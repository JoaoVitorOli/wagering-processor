import { EntityManager } from '@mikro-orm/postgresql';
import { Global, Module } from '@nestjs/common';
import { METRICS, Metrics } from './metrics.js';

@Global()
@Module({
  providers: [
    {
      provide: METRICS,
      useFactory: (em: EntityManager) =>
        new Metrics(async () => {
          const [row] = await em
            .fork()
            .getConnection()
            .execute<{ pending: string; oldest_age_seconds: string | null }[]>(
              `select count(*) as pending,
                      extract(epoch from now() - min(occurred_at)) as oldest_age_seconds
                 from outbox_messages
                where published_at is null`,
            );
          return {
            pending: Number(row.pending),
            oldestAgeSeconds: Number(row.oldest_age_seconds ?? 0),
          };
        }),
      inject: [EntityManager],
    },
  ],
  exports: [METRICS],
})
export class ObservabilityModule {}
