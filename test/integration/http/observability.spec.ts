import { SQSClient } from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createTestApp, type TestApp } from '../../support/test-app.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../support/test-database.js';
import { betFor, createWallet, submit } from '../../support/wagering-client.js';

describe('observability', () => {
  let database: TestDatabase;
  let app: TestApp;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp(database.name);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  async function metrics(url = app.url) {
    return (await fetch(`${url}/metrics`)).text();
  }

  describe('health', () => {
    it('reports the process as alive', async () => {
      const response = await fetch(`${app.url}/health/live`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok' });
    });

    it('reports ready when PostgreSQL and SQS are reachable', async () => {
      const response = await fetch(`${app.url}/health/ready`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        status: 'ok',
        checks: { database: 'up', sqs: 'up' },
      });
    });

    it('reports not ready when SQS is unreachable', async () => {
      const unreachable = new SQSClient({
        endpoint: 'http://localhost:1',
        region: 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        maxAttempts: 1,
      });
      const isolated = await createTestApp(database.name, {
        sqsClient: unreachable,
      });
      try {
        const response = await fetch(`${isolated.url}/health/ready`);

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          status: 'unavailable',
          checks: { database: 'up', sqs: 'down' },
        });
      } finally {
        await isolated.close();
      }
    });
  });

  describe('correlation id', () => {
    it('echoes the received correlation id and stamps it on the events', async () => {
      const response = await fetch(`${app.url}/wallets`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': 'request-123',
        },
        body: JSON.stringify({
          playerId: crypto.randomUUID(),
          initialBalance: { amount: '10.00', currency: 'BRL' },
        }),
      });
      const wallet = await response.json();

      expect(response.headers.get('x-correlation-id')).toBe('request-123');
      const rows = await database.orm.em
        .getConnection()
        .execute<{ correlation_id: string }[]>(
          "select payload->>'correlationId' as correlation_id from outbox_messages where aggregate_id = ?",
          [wallet.id],
        );
      expect(rows).toEqual([
        { correlation_id: 'request-123' },
        { correlation_id: 'request-123' },
      ]);
    });

    it('generates one when the request has none', async () => {
      const response = await fetch(`${app.url}/health/live`);

      expect(response.headers.get('x-correlation-id')).toMatch(
        /^[0-9a-f-]{36}$/,
      );
    });
  });

  describe('metrics', () => {
    it('counts outcomes, duplicates and reconciliation divergences', async () => {
      const wallet = await createWallet(app.url, '20.00');
      const bet = betFor(wallet, '15.00');
      await submit(app.url, bet);
      await submit(app.url, bet);
      await submit(app.url, betFor(wallet, '15.00'));
      await database.orm.em
        .getConnection()
        .execute("update wallets set balance = '1.00' where id = ?", [
          wallet.id,
        ]);
      await fetch(`${app.url}/wallets/${wallet.id}/reconciliation`, {
        method: 'POST',
      });
      await database.orm.em
        .getConnection()
        .execute("update wallets set balance = '5.00' where id = ?", [
          wallet.id,
        ]);

      const text = await metrics();

      expect(text).toContain(
        'wager_transactions_total{source="http",kind="BET",status="PROCESSED"} 1',
      );
      expect(text).toContain(
        'wager_transactions_total{source="http",kind="BET",status="REJECTED"} 1',
      );
      expect(text).toContain('duplicate_requests_total{source="http"} 1');
      expect(text).toContain('reconciliation_divergences_total 1');
      expect(text).toContain(
        'wager_transaction_processing_seconds_count{source="http"} 3',
      );
      expect(text).toMatch(/^outbox_pending_messages \d+$/m);
      expect(text).toMatch(/^outbox_lag_seconds [\d.]+$/m);
      for (const name of [
        'retries_total',
        'dead_letter_messages_total',
        'lock_conflicts_total',
      ]) {
        expect(text).toContain(`# TYPE ${name} counter`);
      }
    });
  });
});
