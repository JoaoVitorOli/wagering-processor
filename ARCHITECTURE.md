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
