# Arquitetura

Este documento explica como o serviço funciona, as decisões técnicas tomadas,
os trade-offs aceitos e as limitações conhecidas.

## Stack

- **Bun 1.4.3**: runtime, gerenciador de pacotes e test runner (exigência do enunciado), sem etapa de build.
- **TypeScript 6** em modo estrito.
- **NestJS 12**: módulos e injeção de dependência só nas camadas `interfaces` e `infra`.
- **PostgreSQL 16** no Docker Compose (`postgres:16-alpine`).
- **MikroORM 7.2.5**: a opção preferencial do enunciado; transações explícitas e locks.
- **decimal.js 10.6.0**: aritmética decimal exata dentro do `Money`.
- **zod 4.6.5**: validação do formato das requisições.

Ferramentas de desenvolvimento: oxlint e Prettier.

As bibliotecas que tocam dinheiro e banco (MikroORM, decimal.js, zod) têm versão exata no `package.json`, para que todo ambiente rode o mesmo código.

## Camadas

- `src/domain`: regras de negócio (`Money`, `Wallet`, `WagerTransaction`). Não importa Nest nem ORM.
- `src/application`: casos de uso e portas (interfaces como `UnitOfWork`, `Clock`, `IdGenerator`). Também não importa Nest nem ORM.
- `src/infra`: implementa as portas (MikroORM, relógio do sistema, UUIDv7).
- `src/interfaces/http`: controllers, validação de entrada e tradução de erros para status HTTP.

As dependências apontam para dentro: `interfaces` e `infra` conhecem `application` e `domain`, nunca o contrário. Os módulos do Nest ligam cada porta à sua implementação com `useFactory`. Por isso os casos de uso podem ser testados sem Nest e sem banco, e o mesmo caso de uso vai servir ao HTTP e ao consumidor SQS.

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

Os mappers (`src/infra/database/mappers`) convertem o domínio na linha do banco e de volta. A leitura usa `rehydrate`, e o dinheiro volta com `Money.from`.

A gravação usa `em.insert`, um INSERT direto, sem o rastreamento de mudanças do ORM: o domínio não é entidade do ORM, e o que vai para o banco fica explícito.

## Unit of Work

A transação SQL é explícita no caso de uso, tudo o que roda dentro de `unitOfWork.run(...)` usa a mesma transação (`em.transactional`). Os repositórios chegam como parâmetro, criados com o `EntityManager` daquela transação, então não existe repositório que escreva fora dela.

Na criação de carteira, a carteira, a transação OPENING e o lançamento de abertura são gravados juntos. Se qualquer insert falhar, o rollback desfaz os outros.

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
- uma única reversão processada por transação, de qualquer tipo (índice único parcial em `reference_transaction_id`).

Ledger: valor positivo, saldos nunca negativos, `antes ± valor = depois`, um lançamento por transação, e nenhuma linha pode ser alterada ou apagada (triggers).

Criar carteira não faz SELECT antes do INSERT. Duas requisições simultâneas veriam "não existe" ao mesmo tempo, então o SELECT não protegeria. Quem decide é a `unique (player_id, currency)`: o repositório traduz a violação em `WalletAlreadyExistsError`, que vira 409. Um teste com 5 requisições simultâneas confirma que só uma grava.

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

Os testes HTTP sobem o `AppModule` real e trocam só a configuração do banco (`ORM_CONFIG`), apontando para o banco descartável. As requisições usam `fetch` numa porta livre. Além das respostas, os testes conferem direto no banco que a OPENING e o lançamento foram gravados.

Os testes de concorrência sobem três instâncias da aplicação apontando para o mesmo banco e disparam requisições em paralelo: duas apostas de 80 numa carteira de 100, 50 cópias da mesma aposta e 45 requisições espalhadas pelas três instâncias. Também conferem que travar uma carteira não bloqueia outra e que um lock além do limite responde 503, com o reenvio aplicado uma vez. Todos terminam conferindo que o saldo da carteira é igual à soma do ledger. Sem o `FOR UPDATE`, esses testes falham.

Os testes de referência cobrem cada tipo, cada código de falha, a regra de uma reversão por transação e a referência ausente. Um teste de concorrência envia um REFUND e um ROLLBACK da mesma BET ao mesmo tempo, por instâncias diferentes, e confere que só um é aplicado.

## Erros globais de regras de negócio

O `src/domain/shared/domain-error.ts` é uma classe abstrata que é a base de todos os erros de regra de negócio. Cada erro possui um código próprio que a camada HTTP pode usar para escolher o status da resposta sem depender do texto da mensagem.

## Money

O `decimal.js` foi a escolha final para lidar com o dinheiro, que faz as contas decimais exatas, como por exemplo: o `decimal.js` garante que `0.1 + 0.2` seja `0.3`. O `number` é proibido para dinheiro.

As regras de entrada são lidadas com o `Money.from` que transforma, por exemplo, `'25.5'` em `'25.50'`, os valores saem como string e com duas casas.

As regras de entrada incluem a recusa de: NaN, Infinity, notação científica, vazio, mais de 2 casas depois do ponto (mais de 2 casas não é arredondado, é recusado), negativo, `+`, vírgula, espaços.

O `money.errors.ts` cuida de implementar os erros referentes ao Money.

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

## Ids e datas

O domínio não gera ids nem lê o relógio: recebe tudo pronto. Quem gera é a aplicação, pelas portas `IdGenerator` e `Clock`, e os testes podem usar valores fixos.

Os ids são UUIDv7 (`Bun.randomUUIDv7()`), como nos exemplos do enunciado. Eles começam pelo horário, então cada id novo entra no fim do índice da chave primária, e não em posições aleatórias.

## Transações

Aqui toda a operação gera transação, mas só as que movem dinheiro geram lançamento, então uma BET que é rejeitada, por exemplo, é registrada sem mexer no ledger.

Na transação de abertura é usado o provedor `internal` e identificadores derivados do id da carteira, o que impede duas aberturas para a mesma carteira. Já nasce como `PROCESSED`, porque acontece junto com a criação da carteira e não tem regra a avaliar.

O banco não garante que a moeda da transação seja a da carteira, nem que a referência seja da mesma carteira. Quem garante é o caso de uso, dentro do lock da carteira.

## Idempotência

O header `Idempotency-Key` é obrigatório e é a fonte da verdade. Sem ele, a resposta é 400.

O `payloadHash` é o SHA-256 de um JSON canônico dos campos de negócio: chaves ordenadas em todos os níveis e campos ausentes fora. O header e os metadados de transporte não entram. O valor entra já normalizado pelo `Money`, então `25.5` e `25.50` são o mesmo pedido.

- Mesma chave e mesmo hash: replay. Devolve o mesmo status e o mesmo corpo da primeira resposta, com `idempotentReplay: true` e o saldo daquele momento.
- Mesma chave e hash diferente: 409 `IDEMPOTENCY_CONFLICT`, sem replay.
- Mesmo `providerId` + `externalTransactionId` com outra chave: 409 `EXTERNAL_TRANSACTION_CONFLICT`. O id externo não pode virar duas transações.

A transação é gravada com `INSERT ... ON CONFLICT DO NOTHING`. Se nada foi inserido, ela já existe: a busca pela chave decide entre replay e conflito, e, se a chave não existe, quem barrou foi a unique do id externo.

## Concorrência

Não existem lock global, então não há bloqueio de carteiras diferentes.

A unidade de concorrência é a carteira. Toda operação que mexe no saldo começa travando a linha da carteira (`SELECT ... FOR UPDATE`) e só solta no commit ou no rollback.

O lock é pessimista, dessa forma toda aposta naquela carteira espera a sua vez. No otimista, toda aposta teria que repetir.

O fluxo de uma BET acontece numa única transação SQL:

1. trava a carteira;
2. grava a transação como PENDING (`ON CONFLICT DO NOTHING`); se já existia, replay ou conflito;
3. confere moeda, jogador e saldo; se falhar, REJECTED com `failureCode`;
4. debita a carteira e grava o lançamento;
5. atualiza a transação para o status final e faz o commit.

Cada transação tem `lock_timeout` (`LOCK_TIMEOUT_MS`, padrão 5 s). Se a carteira continuar travada além disso, a requisição responde 503 em vez de esperar para sempre e segurar conexões.

Fazer o reenvio é seguro, pois o erro acontece antes do commit, quer dizer que houve o rollback e nada foi gravado. Caso o provedor reenvie, a idempotência aplica só a primeira.

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

O que cada tipo pode referenciar:

- WIN e LOSS: uma BET, opcionalmente;
- REFUND: uma BET;
- ROLLBACK: uma BET, um WIN ou um REFUND. ROLLBACK de ROLLBACK é recusado.

O enunciado diz que o WIN "pode" referenciar a BET. Então WIN e LOSS são aceitos com ou sem referência.

A BET com referência é recusada, porque uma aposta não reverte nem completa outra operação.

A transação que referencia a si mesma é recusada também, ela ficaria esperando por ela mesma eternamente.

O enunciado não definiu o valor do LOSS, então ele aceita `0.00`, porque não move saldo e só registra o resultado da rodada. As demais operações exigem valor positivo.

## Referências

A referência é procurada por `providerId` + `referenceExternalTransactionId` e conferida nesta ordem:

1. não existe: a transação fica PENDING_REFERENCE (202) e é processada quando a referência chegar;
2. de outro provedor, carteira, jogador, moeda ou rodada: `REFERENCE_CONTEXT_MISMATCH`;
3. de um tipo que não pode ser referenciado: `REFERENCE_KIND_NOT_ALLOWED`;
4. ainda PENDING_REFERENCE: esta também fica pendente;
5. REJECTED ou FAILED: `REFERENCE_NOT_PROCESSED`;
6. para REFUND e ROLLBACK: valor diferente do da referência dá `AMOUNT_MISMATCH`, e referência já revertida dá `REFERENCE_ALREADY_REVERSED`.

Como a referência precisa ser da mesma carteira, ela também está protegida pelo lock da carteira.

**Interpretação da regra 4.** O enunciado diz que uma referência não pode ser revertida duas vezes "pelo mesmo tipo". Lido ao pé da letra, uma BET aceitaria um REFUND e também um ROLLBACK, e o jogador receberia o valor de volta duas vezes. Crédito duplicado é falha eliminatória, então a regra adotada é mais rígida: cada transação pode ser revertida uma única vez, por qualquer tipo. O ROLLBACK de um REFUND continua permitido, porque reverte outra transação.

**Limitação.** Depois que um REFUND é desfeito por um ROLLBACK, a BET original não pode ser reembolsada de novo: o REFUND continua contando como a reversão dela.

## Saldo no resultado

A transação guarda o saldo de quando terminou (`resultBalance`). Assim, uma requisição repetida devolve exatamente a resposta original, com o saldo daquele momento, e não o saldo atual.

O `resultBalance` é sempre o saldo da carteira, na moeda dela, inclusive quando a transação foi recusada por moeda diferente.

## Códigos de falha (`failure-code`)

- `INSUFFICIENT_FUNDS` - Sem fundos suficientes para fazer a aposta. O provedor não deve reenviar a mesma operação
- `PROCESSING_FAILED` - Erro permanente de infraestrutura, deve ser investigado antes de reenviar.
- `CURRENCY_MISMATCH` - A moeda da transação é diferente da moeda da carteira. O provedor deve corrigir o payload, não reenviar igual.
- `PLAYER_MISMATCH` - O jogador da transação não é o dono da carteira. O provedor deve corrigir o payload, não reenviar igual.
- `REVERSAL_WOULD_OVERDRAW` - A reversão deixaria o saldo negativo (por exemplo, o ROLLBACK de um WIN que já foi apostado). Fica registrada e não deve ser reenviada igual.
- `REFERENCE_CONTEXT_MISMATCH` - A referência é de outro provedor, carteira, jogador, moeda ou rodada. Corrigir o payload.
- `REFERENCE_KIND_NOT_ALLOWED` - O tipo da referência não pode ser referenciado por este tipo (REFUND de WIN, ROLLBACK de ROLLBACK). Corrigir o payload.
- `REFERENCE_NOT_PROCESSED` - A referência existe, mas foi recusada ou falhou. Não reenviar.
- `REFERENCE_ALREADY_REVERSED` - A referência já foi revertida. Não reenviar.
- `AMOUNT_MISMATCH` - O valor da reversão é diferente do valor da referência. Corrigir o payload.

`INSUFFICIENT_FUNDS` e `REVERSAL_WOULD_OVERDRAW` são separados, como o enunciado pede: uma aposta sem saldo e uma reversão que estouraria o saldo são situações operacionais diferentes. Por isso a carteira expõe `canDebit` separado de `debit`: quem escolhe o código é o caso de uso.

O `failure code` não possui um CHECK de lista, ele é um varchar e foi definido assim porque ele vai crescer conforme o desenvolvimento, e o campo não mexe com dinheiro.

## API

A validação da API acontece em dois níveis. O zod confere o formato (`playerId` é UUID, `amount` e `currency` são strings) e responde 400 `INVALID_PAYLOAD` com os campos que estão errados. O domínio `Money` cuida das regras do valor, que responde com `INVALID_MONEY`.

A submissão de transação responde pelo status da transação, sempre com o corpo da transação:

- 200: PROCESSED
- 422: REJECTED por regra de negócio; o corpo traz o `failureCode`
- 202: PENDING_REFERENCE (aceita, processamento pendente)

Todo erro responde no formato `{ code, message }`. O `DomainErrorFilter` escolhe o status pelo `code`:

- 400: `INVALID_PAYLOAD`, `INVALID_MONEY`
- 404: `WALLET_NOT_FOUND`
- 409: `WALLET_ALREADY_EXISTS`, `IDEMPOTENCY_CONFLICT`, `EXTERNAL_TRANSACTION_CONFLICT`
- 500: qualquer código sem mapeamento; a mensagem interna vai para o log e não para a resposta
- 503: `TEMPORARILY_UNAVAILABLE` (lock timeout, deadlock ou queda de conexão), com `Retry-After: 1`; pode ser reenviado

Os erros do banco passam pelo `DatabaseErrorFilter`: os transitórios viram 503 e os demais viram 500, sem expor SQL na resposta.

O filtro para esses erros é registrado com o `APP_FILTER` no `AppModule`, dessa forma os testes tem acesso as mensagens de filtro.
