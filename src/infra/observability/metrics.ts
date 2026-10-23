import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

export const METRICS = Symbol('Metrics');

export interface OutboxBacklog {
  pending: number;
  oldestAgeSeconds: number;
}

export class Metrics {
  readonly registry = new Registry();

  readonly transactions = new Counter({
    name: 'wager_transactions_total',
    help: 'Wager transactions by outcome',
    labelNames: ['source', 'kind', 'status'],
    registers: [this.registry],
  });

  readonly duplicates = new Counter({
    name: 'duplicate_requests_total',
    help: 'Requests and messages recognized as duplicates',
    labelNames: ['source'],
    registers: [this.registry],
  });

  readonly retries = new Counter({
    name: 'retries_total',
    help: 'Work scheduled to be tried again',
    labelNames: ['component'],
    registers: [this.registry],
  });

  readonly deadLetters = new Counter({
    name: 'dead_letter_messages_total',
    help: 'Messages sent to the dead letter queue',
    labelNames: ['reason'],
    registers: [this.registry],
  });

  readonly lockConflicts = new Counter({
    name: 'lock_conflicts_total',
    help: 'Lock timeouts and deadlocks',
    labelNames: ['source'],
    registers: [this.registry],
  });

  readonly processingSeconds = new Histogram({
    name: 'wager_transaction_processing_seconds',
    help: 'Time to process a wager transaction',
    labelNames: ['source'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  readonly reconciliationDivergences = new Counter({
    name: 'reconciliation_divergences_total',
    help: 'Reconciliations whose stored balance differs from the ledger',
    registers: [this.registry],
  });

  constructor(outboxBacklog: () => Promise<OutboxBacklog>) {
    collectDefaultMetrics({ register: this.registry });
    let backlog: Promise<OutboxBacklog> | undefined;
    const current = () =>
      (backlog ??= outboxBacklog().finally(() => {
        backlog = undefined;
      }));

    new Gauge({
      name: 'outbox_pending_messages',
      help: 'Outbox messages not yet published',
      registers: [this.registry],
      async collect() {
        this.set((await current()).pending);
      },
    });
    new Gauge({
      name: 'outbox_lag_seconds',
      help: 'Age of the oldest outbox message not yet published',
      registers: [this.registry],
      async collect() {
        this.set((await current()).oldestAgeSeconds);
      },
    });
  }
}
