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

Para desenvolver com recarga automática:

```bash
bun run start:dev
```

## API

| Método | Rota                     | O que faz                                 |
| ------ | ------------------------ | ----------------------------------------- |
| `POST` | `/wallets`               | cria uma carteira                         |
| `GET`  | `/wallets/:walletId`     | consulta uma carteira                     |
| `POST` | `/wagering/transactions` | submete uma transação (por ora, só `BET`) |

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

Valores de dinheiro são sempre strings decimais com até duas casas (`"25.00"`). Os status HTTP, os códigos de erro e as regras de idempotência estão em [ARCHITECTURE.md](ARCHITECTURE.md).

## Testes

```bash
bun run test:unit
bun run test:integration
```

- **Unidade** (`src/**/*.spec.ts`): não dependem de nada externo.
- **Integração** (`test/integration`): usam o Postgres real do Docker Compose, que precisa estar de pé. Cada arquivo de teste cria um banco próprio com nome aleatório, aplica as migrações e apaga o banco no final.

`bun run test` roda as duas suítes.

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
