# Wagering Processor

Serviço de processamento de transações de apostas, feito para o [desafio técnico da Jungle Gaming](https://github.com/junglegaming/backend-challenge).

As decisões técnicas estão em [ARCHITECTURE.md](ARCHITECTURE.md).

## Pré-requisitos

- [Bun](https://bun.sh) 1.4.3
- Docker com Docker Compose

## Como rodar

```bash
bun install
cp .env.example .env
docker compose up -d --wait
bun run migration:up
bun run start
```

A aplicação sobe em `http://localhost:3000`. Para usar outra porta, altere `PORT` no `.env`.

Se a porta 5432 já estiver em uso na sua máquina, altere `POSTGRES_PORT` no `.env` antes de subir o Docker.

Se a porta 4566 estiver em uso, altere `LOCALSTACK_PORT` e troque a mesma porta em `SQS_ENDPOINT` e nas três URLs de fila (`*_QUEUE_URL`, `*_DLQ_URL`).

`LOCK_TIMEOUT_MS` (padrão `5000`) define quanto tempo uma requisição espera pelo lock de uma carteira antes de responder 503.

`PENDING_REFERENCE_WORKER_ENABLED` (padrão `true`) e `PENDING_REFERENCE_WORKER_INTERVAL_MS` (padrão `1000`) controlam o worker de referências pendentes.

`docker compose up -d --wait` sobe o Postgres e o LocalStack; as filas SQS são criadas na subida. `SQS_CONSUMER_ENABLED=false` desliga o consumidor da fila.

`OUTBOX_PUBLISHER_ENABLED` (padrão `true`) e `OUTBOX_PUBLISHER_INTERVAL_MS` (padrão `1000`) controlam o publisher da outbox; os eventos vão para `wagering-events.fifo`.

Para desenvolver com recarga automática:

```bash
bun run start:dev
```

## API

| Método | Rota                                                                  | O que faz                                                            |
| ------ | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `POST` | `/wallets`                                                            | cria uma carteira                                                    |
| `GET`  | `/wallets/:walletId`                                                  | consulta uma carteira                                                |
| `GET`  | `/wallets/:walletId/ledger`                                           | extrato, do mais novo para o mais antigo (`cursor`, `limit`)         |
| `POST` | `/wallets/:walletId/reconciliation`                                   | confere o saldo contra o ledger                                      |
| `POST` | `/wagering/transactions`                                              | submete uma transação (`BET`, `WIN`, `LOSS`, `REFUND` ou `ROLLBACK`) |
| `GET`  | `/wagering/transactions/:transactionId`                               | consulta uma transação                                               |
| `GET`  | `/providers/:providerId/wagering/transactions/:externalTransactionId` | consulta uma transação pelo id do provedor                           |
| `GET`  | `/health/live`                                                        | o processo está de pé                                                |
| `GET`  | `/health/ready`                                                       | Postgres e SQS alcançáveis                                           |
| `GET`  | `/metrics`                                                            | métricas no formato Prometheus                                       |

Envie `x-correlation-id` para rastrear uma requisição nos logs e nos eventos; sem ele, um id é gerado e devolvido no mesmo header.

Criar uma carteira com saldo inicial:

```bash
curl -s -X POST localhost:3000/wallets \
  -H 'content-type: application/json' \
  -d '{"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","initialBalance":{"amount":"1000.00","currency":"BRL"}}'
```

Submeter uma aposta (troque `<walletId>` pelo `id` devolvido acima):

```bash
curl -s -X POST localhost:3000/wagering/transactions \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: provider-a:transaction-123' \
  -d '{"providerId":"provider-a","externalTransactionId":"transaction-123","playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","walletId":"<walletId>","roundId":"round-987","gameId":"fortune-chimp","kind":"BET","money":{"amount":"25.00","currency":"BRL"}}'
```

Repetir o mesmo comando devolve a mesma resposta com `"idempotentReplay": true`, sem debitar de novo.

Reembolsar essa aposta (`REFUND` e `ROLLBACK` apontam para a transação original em `referenceExternalTransactionId`, com o mesmo valor):

```bash
curl -s -X POST localhost:3000/wagering/transactions \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: provider-a:transaction-124' \
  -d '{"providerId":"provider-a","externalTransactionId":"transaction-124","playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","walletId":"<walletId>","roundId":"round-987","gameId":"fortune-chimp","kind":"REFUND","money":{"amount":"25.00","currency":"BRL"},"referenceExternalTransactionId":"transaction-123"}'
```

A mesma operação também pode chegar pela fila `wager-transactions.fifo`. O grupo da mensagem é a carteira, e a chave de idempotência vai dentro de `data`:

```bash
docker compose exec localstack awslocal sqs send-message \
  --queue-url http://localhost:4566/000000000000/wager-transactions.fifo \
  --message-group-id '<walletId>' \
  --message-deduplication-id message-200 \
  --message-body '{"messageId":"message-200","type":"WagerTransactionRequested","occurredAt":"2026-10-23T12:00:00.000Z","data":{"providerId":"provider-a","externalTransactionId":"transaction-200","idempotencyKey":"provider-a:transaction-200","playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","walletId":"<walletId>","roundId":"round-988","gameId":"fortune-chimp","kind":"BET","money":{"amount":"10.00","currency":"BRL"}}}'
```

O resultado aparece em `GET /providers/provider-a/wagering/transactions/transaction-200`. Mensagens que não podem ser processadas vão para `wager-transactions-dlq.fifo`, e os eventos publicados ficam em `wagering-events.fifo`.

Valores de dinheiro são sempre strings decimais com até duas casas (`"25.00"`). Os status HTTP, os códigos de erro e as regras de idempotência estão em [ARCHITECTURE.md](ARCHITECTURE.md).

## Testes

```bash
bun run test:unit
bun run test:integration
```

- **Unidade** (`src/**/*.spec.ts`): não dependem de nada externo.
- **Integração** (`test/integration`): usam o Postgres real do Docker Compose, que precisa estar de pé. Cada arquivo de teste cria um banco próprio com nome aleatório, aplica as migrações e apaga o banco no final.
- **Concorrência** (`test/integration/concurrency`): sobem três instâncias da aplicação sobre o mesmo banco e disparam requisições em paralelo, incluindo o cenário de duas apostas de `80.00` numa carteira de `100.00`.
- **SQS** (`test/integration/sqs`): usam o LocalStack do Docker Compose, que também precisa estar de pé; cada teste cria filas próprias.
- **Processos** (`test/integration/processes`): sobem processos reais da aplicação, matam e reiniciam no meio do trabalho.

`bun run test` roda as duas suítes.

Onde cada exigência de teste do enunciado é provada:

| Exigência                                           | Teste                                     |
| --------------------------------------------------- | ----------------------------------------- |
| 50 cópias, 80/80, carteiras em paralelo             | `concurrency/bet-concurrency.spec.ts`     |
| ≥ 3 processos, morte entre commit e ack, reinício   | `processes/processes.spec.ts`             |
| inbox, redelivery, retry e DLQ                      | `sqs/wager-transactions-consumer.spec.ts` |
| publishers concorrentes sobre a outbox              | `outbox-publisher.spec.ts`                |
| atomicidade entre carteira, ledger e outbox         | `outbox.spec.ts`                          |
| REFUND ou ROLLBACK antes da referência              | `pending-references.spec.ts`              |
| migrações e constraints                             | `database.spec.ts`, `schema.spec.ts`      |

## Comandos

| Comando                          | O que faz                                       |
| -------------------------------- | ----------------------------------------------- |
| `bun run start`                  | sobe a aplicação                                |
| `bun run start:dev`              | sobe a aplicação recarregando a cada alteração  |
| `bun run start:debug`            | sobe com o inspector ativo e recarga automática |
| `bun run test`                   | roda todos os testes                            |
| `bun run test:unit`              | roda só os testes de unidade                    |
| `bun run test:integration`       | roda só os testes de integração                 |
| `bun run test:watch`             | roda os testes a cada alteração                 |
| `bun run test:cov`               | roda os testes com cobertura                    |
| `bun run test:debug`             | roda os testes com o inspector ativo            |
| `bun run migration:up`           | aplica as migrações pendentes                   |
| `bun run migration:down`         | desfaz a última migração                        |
| `bun run migration:list`         | lista as migrações já aplicadas                 |
| `bun run migration:create`       | gera uma migração a partir das entidades do ORM |
| `bun run migration:create:blank` | cria uma migração vazia para escrever à mão     |
| `bun run typecheck`              | checa os tipos com o compilador do TypeScript   |
| `bun run lint`                   | roda o linter                                   |
| `bun run format`                 | formata o código                                |
