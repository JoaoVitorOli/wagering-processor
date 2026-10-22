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

As entidades persistentes ficam em `src/infra/database/entities` e são feitas usando o `defineEntity`, sem decorators.

Os valores são definidos com `p.decimal('string').precision(18).scale(2)` que no final são `numeric(18,2)`, que são lidos como string. Nunca passam por number.

## Garantias do banco

O domínio recusa primeiro, com erro claro e código estável. O banco recusa sempre, para qualquer caminho que chegue nele. O domínio decide e o banco garante.

Em requisições concorrentes iguais, quem desempata é a `unique`: uma grava,
a outra recebe a violação. A concorrência do saldo é garantida pelo lock da
carteira (ver Concorrência).

Carteiras: saldo nunca negativo, versão a partir de 1, moeda ISO-4217 e uma carteira por jogador e moeda.

Transações:

- chave de idempotência única e id externo único por provedor;
- valor positivo (LOSS aceita `0.00`);
- REFUND e ROLLBACK exigem referência, OPENING e BET não têm, e ninguém referencia a si mesmo;
- `failure_code` só em REJECTED/FAILED, `processed_at` só nos status finais;
- uma reversão processada por tipo para a mesma referência (índice único parcial).

O índice de reversão ignora `NULL`. Por isso o `reversal_resolved_check` obriga toda reversão processada a apontar para a transação revertida, sem ele, uma reversão com referência nula escaparia do índice e a mesma transação poderia ser revertida duas vezes.

## Migrações

São geradas de forma automática a partir do script `migration:create`, para migrações escritas a mão é usado o `migration:create:blank`.

Rodam em transação, todas juntas (`transactional`, `allOrNothing`): ou o banco vai inteiro para a versão nova, ou fica na anterior.

Os scripts usam `--bun` para o CLI ler a configuração em TypeScript e `--env-file=.env` porque, assim, o Bun não carrega o `.env` sozinho.

O gerador cria todas as migrations, inclusive a trigger de UPDATE/DELETE. Com exceção do trigger de TRUNCATE, que é preciso ser feita a mão, pois o MikroORM não enxerga e recriaria ela a cada migração.

## Testes de integração

Usam o PostgreSQL real, sem mock. Cada arquivo de teste cria um banco aleatório (`wagering_test_` + UUID), aplica as migrações e apaga o banco no final. Isso em vez de limpar tabelas porque:

- testes em paralelo não interferem entre si;
- o ledger não permite apagar linhas;
- todo teste também prova que as migrações funcionam.

O teste de integração dos schemas conferem o nome da constraint que é retornada quando algo errado é passado, há também casos positivos validando outra moeda, outro provedor, LOSS com 0, REFUND + ROLLBACK da mesma referência.

## Erros globais de regras de negócio

O `src/domain/shared/domain-error.ts` é uma classe abstrata que é a base de todos os erros de regra de negócio. Cada erro possui um código próprio que a camada HTTP pode usar para escolher o status da resposta sem depender do texto da mensagem.

## Money

O `decimal.js` foi a escolha final para lidar com o dinheiro, que faz as contas decimais exatas, como por exemplo: o `decimal.js` garante que `0.1 + 0.2` seja `0.3`. O `number` é proibido para dinheiro.

As regras de entrada são lidadas com o `Money.from` que transforma, por exemplo, `'25.5'` em `'25.50'`, os valores saem como string e com duas casas.

As regras de entrada incluem a recusa de: NaN, Infinity, notação científica, vazio, mais de 2 casas depois do ponto (mais de 2 casas não é arredondado, é recusado), negativo, `+`, vírgula, espaços.

O `money.erros.ts` cuida de implementar os erros referentes ao Money.

Somar, subtrair e comparar com `isLessThan` lançam `CurrencyMismatchError`, porque não têm resposta sem câmbio. Já `equals` devolve `false`, porque valores em moedas diferentes simplesmente não são iguais.

## Wallet e ledger

A `Wallet` é o aggregate root, o saldo só muda por `debit` e `credit`, os dois sempre geram o lançamento, os dois devolvem o `WalletLedgerEntry` correspondente.

O `version` sempre começa por 1, só vai mudar quando o saldo for alterado.

O `Wallet.open` cria o lançamento de abertura com saldo inicial maior que zero. Com saldo zero, não cria lançamento e o `version` não é alterado. Saldo inicial negativo é recusado.

O `canDebit` apenas faz a consulta para garantir que se pode fazer um débito.

O lançamento é criado e validado antes de a carteira mudar. Se a validação falhar, a carteira fica exatamente como estava.

O `WalletLedgerEntry` não tem nenhum campo que possa mudar: além do `readonly`, o objeto é congelado com `Object.freeze`, então qualquer tentativa de alteração lança erro em tempo de execução.

## Criação e rehydrate

`Wallet.open` e `WalletLedgerEntry.create` são usados para o que está nascendo agora, e validam todas as regras.

`rehydrate` reconstrói o que veio do banco, sem validar e sem mudar a versão. O dado já foi validado quando nasceu, e revalidar impediria ler registros antigos se uma regra mudasse.

## Transações

Aqui toda a operação gera transação, mas só as que movem dinheiro geram lançamento, então uma BET que é rejeitada, por exemplo, é registrada sem mexer no ledger.

Na transação de abertura é usado o provedor `internal` e identificadores derivados do id da carteira, o que impede duas aberturas para a mesma carteira. Já nasce como `PROCESSED`, porque acontece junto com a criação da carteira e não tem regra a avaliar.

O banco não garante que a moeda da transação seja a da carteira, nem que a referência seja da mesma carteira. Quem garante é o caso de uso, dentro do lock da carteira.

## Status e transições

```
PENDING ──► PENDING_REFERENCE ──► PROCESSED | REJECTED | FAILED
   └────────────────────────────► PROCESSED | REJECTED | FAILED
```

- `PENDING`: recebida, ainda não aplicada.
- `PENDING_REFERENCE`: aguardando a transação referenciada chegar.
- `PROCESSED`, `REJECTED` e `FAILED` são finais. Tentar mudar uma transação finalizada lança `InvalidTransactionStateError`, porque isso só acontece por erro de programação. O provedor já recebeu a resposta e o ledger já foi gravado; para desfazer algo, é preciso uma nova operação (REFUND ou ROLLBACK).

As transições permitidas ficam numa tabela no código, e é ela que define quais status são finais.

## Efeito de cada operação

- BET - débito
- WIN, REFUND, OPENING - crédito
- LOSS - nenhum
- ROLLBACK - o inverso das referências acima, crédito para BET e débito para WIN e REFUND.

O enunciado diz que o WIN "pode" referenciar a BET. Então WIN e LOSS são aceitos com ou sem referência.

A BET com referência é recusada, porque uma aposta não reverte nem completa outra operação.

A transação que referencia a si mesma é recusada também, ela ficaria esperando por ela mesma eternamente.

O enunciado não definiu o valor do LOSS, então ele aceita `0.00`, porque não move saldo e só registra o resultado da rodada. As demais operações exigem valor positivo.

## Saldo no resultado

A transação guarda o saldo de quando terminou (`resultBalance`). Assim, uma requisição repetida devolve exatamente a resposta original, com o saldo daquele momento, e não o saldo atual.

## Códigos de falha (`failure-code`)

- `INSUFFICIENT_FUNDS` - Sem fundos suficientes para fazer a aposta. O provedor não deve reenviar a mesma operação
- `PROCESSING_FAILED` - Erro permanente de infraestrutura, deve ser investigado antes de reenviar.

O `failure code` não possui um CHECK de lista, ele é um varchar e foi definido assim porque ele vai crescer conforme o desenvolvimento, e o campo não mexe com dinheiro.
