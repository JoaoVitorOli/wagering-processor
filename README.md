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

## Testes

```bash
bun run test:unit
bun run test:integration
```

- **Unidade** (`src/**/*.spec.ts`): não dependem de nada externo.
- **Integração** (`test/integration`): usam o Postgres real do Docker Compose, que precisa estar de pé. Cada arquivo de teste cria um banco próprio com nome aleatório, aplica as migrações e apaga o banco no final.

`bun run test` roda as duas suítes.

## Comandos

| Comando                    | O que faz                                       |
| -------------------------- | ----------------------------------------------- |
| `bun run start`            | sobe a aplicação                                |
| `bun run start:dev`        | sobe a aplicação recarregando a cada alteração  |
| `bun run start:debug`      | sobe com o inspector ativo e recarga automática |
| `bun run test`             | roda todos os testes                            |
| `bun run test:unit`        | roda só os testes de unidade                    |
| `bun run test:integration` | roda só os testes de integração                 |
| `bun run test:watch`       | roda os testes a cada alteração                 |
| `bun run test:cov`         | roda os testes com cobertura                    |
| `bun run migration:up`     | aplica as migrações pendentes                   |
| `bun run migration:down`   | desfaz a última migração                        |
| `bun run migration:list`   | lista as migrações já aplicadas                 |
| `bun run migration:create` | cria uma migração vazia para escrever à mão     |
| `bun run typecheck`        | checa os tipos com o compilador do TypeScript   |
| `bun run lint`             | roda o linter                                   |
| `bun run format`           | formata o código                                |
