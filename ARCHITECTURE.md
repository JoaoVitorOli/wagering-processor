# Arquitetura

Este documento explica como o serviço funciona, as decisões técnicas tomadas,
os trade-offs aceitos e as limitações conhecidas.

## Ferramentas de execução

O runtime do projeto é feito usando Bun, assim como exigido no enunciado. A versão fica fixa em `packageManager` e `engines` no `package.json` para que todo mundo rode a mesma versão. O Bun também é o gerenciador de pacotes e o test runner.

Não existe etapa de build no projeto. O Bun executa o Typescript direto, por isso não tem `nest build` nem `dist`.

Como o Bun não checa tipos, a checagem fica a cargo do `bun run typecheck`.

Foi removido a CLI do Nest (`nest-cli.json` `tsconfig.build.json`), são ferramentas que para essa apliação não vão ter uso, pois não vai haver etapa de build (por conta do bun) e os modulos do Nest não vão ser gerados pela CLI.

## Docker

Versões fixas da imagem do Postgres para que todos que executem tenham a mesma infra. A porta é configurável através do `POSTGRES_PORT`.

## Persistência

PostgreSQL com MikroORM, a opção preferencial do enunciado. Os pacotes do MikroORM têm versão exata, porque precisam estar todos na mesma versão.

A função `createOrmConfig` (`src/infra/database/mikro-orm.config.ts`) gera a configuração usada pela aplicação, pelo CLI e pelos testes. Os testes só trocam o nome do banco.

### Migrações

- São geradas de forma automática a partir do script `migration:create`, para migrações escritas a mão é usado o `migration:create:blank`.
- Rodam em transação, todas juntas (`transactional`, `allOrNothing`): ou o banco vai inteiro para a versão nova, ou fica na anterior.
- Os scripts usam `--bun` para o CLI ler a configuração em TypeScript e `--env-file=.env` porque, assim, o Bun não carrega o `.env` sozinho.

## Testes de integração

Usam o PostgreSQL real, sem mock. Cada arquivo de teste cria um banco aleatório (`wagering_test_` + UUID), aplica as migrações e apaga o banco no final. Isso em vez de limpar tabelas porque:

- testes em paralelo não interferem entre si;
- o ledger não permite apagar linhas;
- todo teste também prova que as migrações funcionam.

## Erros globais de regras de negócio

O `src/domain/shared/domain-error.ts` é uma classe abstrata que é a base de todos os erros de regra de negócio. Cada erro possui um código próprio que a camada HTTP pode usar para escolher o status da resposta sem depender do texto da mensagem.

## Money

O `decimal.js` foi a escolha final para lidar com o dinheiro, que faz as contas decimais exatas. O `number` é proibido para dinheiro.

As regras de entrada são lidadas com o `Money.from` que transforma, por exemplo, `'25.5'` em `'25.50'`, os valores saem como string e com duas casas.

O `money.erros.ts` cuida de implementar os erros referentes ao Money.

As funções privadas `assertSameCurrency` e `assertValidCurrency` cuidam de validar a moeda antes de retornar o que alguns métodos aritméticos prometem, validando se o currency é da mesma moeda, e se a entrada dele é válida.
