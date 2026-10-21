# Wagering Processor

Serviço de processamento de transações de apostas, feito para o [desafio técnico da Jungle Gaming](https://github.com/junglegaming/backend-challenge).

As decisões técnicas estão em [ARCHITECTURE.md](ARCHITECTURE.md).

## Pré-requisitos

- [Bun](https://bun.sh) 1.4.3

## Como rodar

```bash
bun install
bun run start
```

A aplicação sobe em `http://localhost:3000`. Para usar outra porta, defina a variável `PORT`.

Para desenvolver com recarga automática:

```bash
bun run start:dev
```

## Comandos

| Comando | O que faz |
|---|---|
| `bun run start` | sobe a aplicação |
| `bun run start:dev` | sobe a aplicação recarregando a cada alteração |
| `bun run start:debug` | sobe com o inspector ativo e recarga automática |
| `bun run test` | roda os testes |
| `bun run test:watch` | roda os testes a cada alteração |
| `bun run test:cov` | roda os testes com cobertura |
| `bun run typecheck` | checa os tipos com o compilador do TypeScript |
| `bun run lint` | roda o linter |
| `bun run format` | formata o código |
