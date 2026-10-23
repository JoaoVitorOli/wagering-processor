# Arquitetura

Este documento explica como o serviço funciona, as decisões técnicas tomadas,
os trade-offs aceitos e as limitações conhecidas.

## Visão geral

O serviço recebe transações de apostas de provedores (BET, WIN, LOSS, REFUND e ROLLBACK) por HTTP ou pela fila SQS e aplica cada uma na carteira do jogador, exatamente uma vez.

O caminho de uma transação, nos dois canais:

1. trava a carteira no Postgres;
2. grava a transação; se a chave de idempotência já existe, devolve a resposta original;
3. aplica as regras e, se passar, muda o saldo e grava o lançamento no ledger;
4. grava os eventos na outbox;
5. faz o commit, e só então responde (HTTP) ou confirma a mensagem (SQS).

Depois, um worker publica os eventos da outbox em outra fila, e outro worker retenta as transações que chegaram antes da referência.

Tudo o que protege o dinheiro está no banco: lock da carteira, uniques de idempotência, CHECKs e ledger imutável. A fila e os workers podem entregar ou rodar de novo sem risco.

## Stack

- **Bun 1.4.3**: runtime, gerenciador de pacotes e test runner (exigência do enunciado), sem etapa de build.
- **TypeScript 6** em modo estrito.
- **NestJS 12**: módulos e injeção de dependência só nas camadas `interfaces` e `infra`.
- **PostgreSQL 16** no Docker Compose (`postgres:16-alpine`).
- **MikroORM 7.2.5**: a opção preferencial do enunciado; transações explícitas e locks.
- **decimal.js 10.6.0**: aritmética decimal exata dentro do `Money`.
- **zod 4.6.5**: validação do formato das requisições.
- **LocalStack 4.8.1**: SQS local, versão fixa (a latest exige token).

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

Não existe etapa de build no projeto. O Bun executa o TypeScript direto, por isso não tem `nest build` nem `dist`.

Como o Bun não checa tipos, a checagem fica a cargo do `bun run typecheck`.

O projeto não usa o CLI do Nest (`nest-cli.json`, `tsconfig.build.json`): não existe etapa de build e os módulos do Nest são escritos à mão.

## Docker

As imagens têm versão fixa (`postgres:16-alpine` e `localstack/localstack:4.8.1`), para que todos que executem tenham a mesma infra. As portas são configuráveis por `POSTGRES_PORT` e `LOCALSTACK_PORT`.

## Money

O dinheiro usa o `decimal.js`, que faz as contas decimais exatas: `0.1 + 0.2` é `0.3`. O `number` é proibido para dinheiro.

O valor é conferido por uma regex antes de chegar no `Decimal`, porque o `Decimal` aceitaria `1e3` e `Infinity`. A regex permite até 16 dígitos inteiros, o mesmo limite da coluna `numeric(18,2)`. O `Money` usa uma cópia do `Decimal` com precisão própria (`Decimal.clone({ precision: 40 })`), para não depender da configuração global.

As regras de entrada são lidadas com o `Money.from` que transforma, por exemplo, `'25.5'` em `'25.50'`, os valores saem como string e com duas casas.

As regras de entrada incluem a recusa de: NaN, Infinity, notação científica, vazio, mais de 2 casas depois do ponto (mais de 2 casas não é arredondado, é recusado), negativo, `+`, vírgula, espaços.

O `money.errors.ts` cuida de implementar os erros referentes ao Money.

Somar, subtrair e comparar com `isLessThan` lançam `CurrencyMismatchError`, porque não têm resposta sem câmbio. Já `equals` devolve `false`, porque valores em moedas diferentes simplesmente não são iguais.

## Erros globais de regras de negócio

O `src/domain/shared/domain-error.ts` é uma classe abstrata que é a base de todos os erros de regra de negócio. Cada erro possui um código próprio que a camada HTTP pode usar para escolher o status da resposta sem depender do texto da mensagem.

## Wallet e ledger

A `Wallet` é o aggregate root, o saldo só muda por `debit` e `credit`, os dois sempre geram o lançamento, os dois devolvem o `WalletLedgerEntry` correspondente.

O `version` começa em 1, com ou sem saldo inicial, e só sobe quando o saldo muda.

O `Wallet.open` cria o lançamento de abertura com saldo inicial maior que zero. Com saldo zero, não cria lançamento. Saldo inicial negativo é recusado.

O `canDebit` só consulta se o débito cabe no saldo. Quem escolhe o `failureCode` é o caso de uso, porque a carteira não sabe se é uma aposta ou uma reversão (ver Códigos de falha). O `debit` ainda lança `InsufficientFundsError` como última proteção.

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

### Status e transições

```
PENDING ──► PENDING_REFERENCE ──► PROCESSED | REJECTED | FAILED
   └────────────────────────────► PROCESSED | REJECTED | FAILED
```

- `PENDING`: recebida, ainda não aplicada.
- `PENDING_REFERENCE`: aguardando a transação referenciada chegar.
- `PROCESSED`, `REJECTED` e `FAILED` são finais. Tentar mudar uma transação finalizada lança `InvalidTransactionStateError`, porque isso só acontece por erro de programação. O provedor já recebeu a resposta e o ledger já foi gravado; para desfazer algo, é preciso uma nova operação (REFUND ou ROLLBACK).

As transições permitidas ficam numa tabela no código, e é ela que define quais status são finais.

### Efeito de cada operação

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

### Referências

A referência é procurada por `providerId` + `referenceExternalTransactionId` e conferida nesta ordem:

1. não existe: a transação fica PENDING_REFERENCE (202) e é processada quando a referência chegar;
2. de outro provedor, carteira, jogador, moeda ou rodada: `REFERENCE_CONTEXT_MISMATCH`;
3. de um tipo que não pode ser referenciado: `REFERENCE_KIND_NOT_ALLOWED`;
4. ainda PENDING_REFERENCE: esta também fica pendente;
5. REJECTED ou FAILED: `REFERENCE_NOT_PROCESSED`;
6. para REFUND e ROLLBACK: valor diferente do da referência dá `AMOUNT_MISMATCH`, e referência já revertida dá `REFERENCE_ALREADY_REVERSED`.

Como a referência precisa ser da mesma carteira, ela também está protegida pelo lock da carteira.

Pendentes são retentadas por um worker (a cada 1 s): espera de 1 s dobrando até 60 s, no máximo 10 tentativas (~5 min). Esgotou: REJECTED `REFERENCE_NOT_FOUND`. Retentativa sem sucesso não gera evento. O replay de uma pendente já resolvida devolve o estado atual.

**Interpretação da regra 4.** O enunciado diz que uma referência não pode ser revertida duas vezes "pelo mesmo tipo". Lido ao pé da letra, uma BET aceitaria um REFUND e também um ROLLBACK, e o jogador receberia o valor de volta duas vezes. Crédito duplicado é falha eliminatória, então a regra adotada é mais rígida: cada transação pode ser revertida uma única vez, por qualquer tipo. O ROLLBACK de um REFUND continua permitido, porque reverte outra transação.

**Limitação.** Depois que um REFUND é desfeito por um ROLLBACK, a BET original não pode ser reembolsada de novo: o REFUND continua contando como a reversão dela.

### Saldo no resultado

A transação guarda o saldo de quando terminou (`resultBalance`). Assim, uma requisição repetida devolve exatamente a resposta original, com o saldo daquele momento, e não o saldo atual.

O `resultBalance` é sempre o saldo da carteira, na moeda dela, inclusive quando a transação foi recusada por moeda diferente.

### Códigos de falha (`failure-code`)

- `INSUFFICIENT_FUNDS` - Sem fundos suficientes para fazer a aposta. O provedor não deve reenviar a mesma operação.
- `PROCESSING_FAILED` - Reservado para erro permanente de infraestrutura (status `FAILED`); deve ser investigado antes de reenviar. Nenhum fluxo usa hoje.
- `CURRENCY_MISMATCH` - A moeda da transação é diferente da moeda da carteira. O provedor deve corrigir o payload, não reenviar igual.
- `PLAYER_MISMATCH` - O jogador da transação não é o dono da carteira. O provedor deve corrigir o payload, não reenviar igual.
- `REVERSAL_WOULD_OVERDRAW` - A reversão deixaria o saldo negativo (por exemplo, o ROLLBACK de um WIN que já foi apostado). Fica registrada e não deve ser reenviada igual.
- `REFERENCE_CONTEXT_MISMATCH` - A referência é de outro provedor, carteira, jogador, moeda ou rodada. Corrigir o payload.
- `REFERENCE_KIND_NOT_ALLOWED` - O tipo da referência não pode ser referenciado por este tipo (REFUND de WIN, ROLLBACK de ROLLBACK). Corrigir o payload.
- `REFERENCE_NOT_PROCESSED` - A referência existe, mas foi recusada ou falhou. Não reenviar.
- `REFERENCE_ALREADY_REVERSED` - A referência já foi revertida. Não reenviar.
- `AMOUNT_MISMATCH` - O valor da reversão é diferente do valor da referência. Corrigir o payload.
- `REFERENCE_NOT_FOUND` - A referência não chegou no prazo. Final; reenviar como nova transação.

`INSUFFICIENT_FUNDS` e `REVERSAL_WOULD_OVERDRAW` são separados, como o enunciado pede: uma aposta sem saldo e uma reversão que estouraria o saldo são situações operacionais diferentes. Por isso a carteira expõe `canDebit` separado de `debit`: quem escolhe o código é o caso de uso.

O `failure_code` não tem CHECK de lista: é um texto, para que um código novo não precise de migração. O domínio garante os valores, e o campo não mexe com dinheiro.

## Persistência

PostgreSQL com MikroORM, a opção preferencial do enunciado. Os pacotes do MikroORM têm versão exata, porque precisam estar todos na mesma versão.

A função `createOrmConfig` (`src/infra/database/mikro-orm.config.ts`) gera a configuração usada pela aplicação, pelo CLI e pelos testes. Os testes só trocam o nome do banco.

As entidades persistentes ficam em `src/infra/database/entities` e são feitas usando o `defineEntity`, sem decorators.

Os valores são definidos com `p.decimal('string').precision(18).scale(2)`, que no banco vira `numeric(18,2)` e é lido como string. Nunca passam por `number`.

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

Outbox: `attempts >= 0` e índice parcial nos não publicados.

Referências pendentes: `next_reference_attempt_at` existe só em PENDING_REFERENCE; `reference_attempts >= 0`.

Inbox: chave primária `(consumer_name, message_id)`.

## Migrações

São geradas de forma automática a partir do script `migration:create`, para migrações escritas a mão é usado o `migration:create:blank`.

Rodam em transação, todas juntas (`transactional`, `allOrNothing`): ou o banco vai inteiro para a versão nova, ou fica na anterior.

Os scripts usam `--bun` para o CLI ler a configuração em TypeScript e `--env-file=.env` porque, assim, o Bun não carrega o `.env` sozinho.

O gerador cria todas as migrations, inclusive a trigger de UPDATE/DELETE. Com exceção do trigger de TRUNCATE, que é preciso ser feita a mão, pois o MikroORM não enxerga e recriaria ela a cada migração.

## Idempotência

O header `Idempotency-Key` é obrigatório e é a fonte da verdade. Sem ele, a resposta é 400.

O `payloadHash` é o SHA-256 de um JSON canônico dos campos de negócio: chaves ordenadas em todos os níveis e campos ausentes fora. O header e os metadados de transporte não entram. O valor entra já normalizado pelo `Money`, então `25.5` e `25.50` são o mesmo pedido.

- Mesma chave e mesmo hash: replay. Devolve o mesmo status e o mesmo corpo da primeira resposta, com `idempotentReplay: true` e o saldo daquele momento.
- Mesma chave e hash diferente: 409 `IDEMPOTENCY_CONFLICT`, sem replay.
- Mesmo `providerId` + `externalTransactionId` com outra chave: 409 `EXTERNAL_TRANSACTION_CONFLICT`. O id externo não pode virar duas transações.

A transação é gravada com `INSERT ... ON CONFLICT DO NOTHING`. Se nada foi inserido, ela já existe: a busca pela chave decide entre replay e conflito, e, se a chave não existe, quem barrou foi a unique do id externo.

## Concorrência

Não existe lock global, então não há bloqueio de carteiras diferentes.

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

O worker de referências pendentes pode rodar em várias instâncias: cada um trava a carteira e relê a transação; se ela já não estiver pendente, pula.

## Outbox

Eventos são gravados em `outbox_messages` na mesma transação da operação e publicados depois por um worker. Publicar antes do commit poderia anunciar um rollback; depois, perder o evento se o processo morresse.

- PROCESSED: `WagerTransactionProcessed` (+ `WalletBalanceChanged` se o saldo mudou)
- REJECTED: `WagerTransactionRejected`
- PENDING_REFERENCE: `WagerTransactionPendingReference`
- replay: nenhum

A OPENING com saldo também gera os dois eventos, porque muda o saldo.

Cada evento é uma classe com `eventType` e `version` fixos, serializada num envelope: `eventId`, `eventType`, `aggregateId`, `correlationId`, `causationId` (opcional), `occurredAt`, `version` e `data`. O dinheiro vai como string, igual na API. Uma mudança incompatível vira uma nova `version`.

`aggregateId` é a carteira (ordem por carteira); `eventId` único permite deduplicar no consumidor.

O publisher pega os pendentes com `FOR UPDATE SKIP LOCKED` (vários publishers não pegam o mesmo evento), publica e marca na mesma transação. Se morrer antes do commit, o evento é publicado de novo: a duplicata é segura pelo `eventId`. Falha ao publicar: nova tentativa de 1 s dobrando até 5 min, sem limite. Só sai o evento mais antigo pendente de cada carteira, para manter a ordem.

## SQS

O consumidor usa o mesmo caso de uso do HTTP. A inbox `(consumer_name, message_id)` é gravada na mesma transação; mensagem repetida é confirmada sem reprocessar. O ack só acontece depois do commit.

- Resultado de negócio (inclusive REJECTED): ack.
- Erro permanente (payload inválido, carteira inexistente, conflito): DLQ na hora, com `errorCode`.
- Erro transitório: volta para a fila com espera crescente; após 5 entregas, a fila move para a DLQ.

Mensagens de um lote são processadas em ordem (grupo FIFO = carteira). No SIGTERM, a mensagem atual termina e o resto volta para a fila.

O script `docker/localstack/init-queues.sh` cria as filas na subida do LocalStack, todas FIFO e com `ContentBasedDeduplication=false` (a deduplicação é por id explícito, não pelo conteúdo):

- `wager-transactions.fifo`: entrada. Visibilidade de 30 s e `RedrivePolicy` para a DLQ depois de 5 entregas.
- `wager-transactions-dlq.fifo`: mensagens que não podem ser processadas, com o `errorCode` como atributo.
- `wagering-events.fifo`: saída dos eventos da outbox. `MessageGroupId` = carteira e `MessageDeduplicationId` = `eventId`. Não tem DLQ, porque quem guarda o evento até ser publicado é a outbox.

A FIFO é uma otimização. A garantia de não aplicar duas vezes está no banco (inbox e idempotência), então tudo funcionaria com uma fila padrão.

## API

A validação da API acontece em dois níveis. O zod confere o formato (`playerId` é UUID, `amount` e `currency` são strings) e responde 400 `INVALID_PAYLOAD` com os campos que estão errados. O domínio `Money` cuida das regras do valor, que responde com `INVALID_MONEY`.

A submissão de transação responde pelo status da transação, sempre com o corpo da transação:

- 200: PROCESSED
- 422: REJECTED por regra de negócio; o corpo traz o `failureCode`
- 202: PENDING_REFERENCE (aceita, processamento pendente)
- 500: FAILED (reservado, ver `PROCESSING_FAILED`)

Todo erro responde no formato `{ code, message }`. O `DomainErrorFilter` escolhe o status pelo `code`:

- 400: `INVALID_PAYLOAD`, `INVALID_MONEY`
- 404: `WALLET_NOT_FOUND`
- 409: `WALLET_ALREADY_EXISTS`, `IDEMPOTENCY_CONFLICT`, `EXTERNAL_TRANSACTION_CONFLICT`
- 500: qualquer código sem mapeamento; a mensagem interna vai para o log e não para a resposta
- 503: `TEMPORARILY_UNAVAILABLE` (lock timeout, deadlock ou queda de conexão), com `Retry-After: 1`; pode ser reenviado

Os erros do banco passam pelo `DatabaseErrorFilter`: os transitórios viram 503 e os demais viram 500, sem expor SQL na resposta.

Os filtros são registrados com `APP_FILTER` no `AppModule`, e não no `main.ts`: os testes sobem o `AppModule` sem executar o `main.ts`, e assim os filtros valem nos dois.

## Extrato e reconciliação

O extrato (`GET /wallets/:walletId/ledger`) vem do mais novo para o mais antigo. O cursor é a posição (`sequence`) do último item da página, em base64url; o cliente não deve interpretar. A próxima página pega `sequence` menor que o cursor. Como o ledger só cresce, lançamentos novos não mudam as páginas seguintes. `limit` padrão 50, máximo 100; cursor inválido responde 400 `INVALID_CURSOR`.

O `sequence` é um `bigserial` com índice `(wallet_id, sequence)`, para a ordem ser estável mesmo com lançamentos no mesmo milissegundo.

A reconciliação (`POST /wallets/:walletId/reconciliation`) soma créditos e débitos do ledger no banco e compara com o saldo gravado. A carteira fica travada com `FOR SHARE` durante a conta, para uma aposta concorrente não criar uma divergência falsa. Ela não corrige nada: responde `consistent: false` com a diferença, registra um log de aviso e incrementa a métrica de divergências. Corrigir automaticamente esconderia o bug que causou a diferença.

## Cenários de falha

- **Processo morre antes do commit:** o Postgres faz rollback e nada fica gravado. Pelo HTTP, o provedor reenvia e a operação é aplicada uma vez; pela fila, a mensagem volta depois da visibilidade. Teste: `processes.spec.ts` (reinício no meio do trabalho).
- **Processo morre depois do commit e antes do ack:** a mensagem volta, a inbox já tem o `messageId` e ela é confirmada sem tocar na carteira. Teste: `processes.spec.ts` (failpoint) e `wager-transactions-consumer.spec.ts`.
- **Processo morre depois do commit e antes da resposta HTTP:** o reenvio cai no replay e devolve a resposta original.
- **Processo morre entre publicar o evento e marcar como publicado:** o evento é publicado de novo, com o mesmo `eventId`. Teste: `outbox-publisher.spec.ts`.
- **SQS fora:** o publisher reagenda os eventos e a outbox guarda tudo; o consumidor só volta a ler quando o SQS volta; `/health/ready` responde 503. Teste: `observability.spec.ts` e `outbox-publisher.spec.ts`.
- **Postgres fora ou carteira travada demais:** a requisição responde 503 com `Retry-After`, e a mensagem da fila volta com espera crescente até ir para a DLQ. Teste: `bet-concurrency.spec.ts` e `wager-transactions-consumer.spec.ts` (lock).
- **Mensagem que nunca vai dar certo:** DLQ na hora, com `errorCode`. Teste: `wager-transactions-consumer.spec.ts`.

## Testes de integração

Usam o PostgreSQL real, sem mock. Cada arquivo de teste cria um banco aleatório (`wagering_test_` + UUID), aplica as migrações e apaga o banco no final. Isso em vez de limpar tabelas porque:

- testes em paralelo não interferem entre si;
- o ledger não permite apagar linhas;
- todo teste também prova que as migrações funcionam.

Os testes de schema conferem o nome da constraint que recusa cada dado errado. Também há casos positivos: outra moeda para o mesmo jogador, o mesmo id externo em outro provedor, LOSS com `0.00` e reversões recusadas que não ocupam o índice de reversão.

Os testes HTTP sobem o `AppModule` real e trocam só a configuração do banco (`ORM_CONFIG`), apontando para o banco descartável. As requisições usam `fetch` numa porta livre. Além das respostas, os testes conferem direto no banco que a OPENING e o lançamento foram gravados.

Os testes de concorrência sobem três instâncias da aplicação apontando para o mesmo banco e disparam requisições em paralelo: duas apostas de 80 numa carteira de 100, 50 cópias da mesma aposta e 45 requisições espalhadas pelas três instâncias. Também conferem que travar uma carteira não bloqueia outra e que um lock além do limite responde 503, com o reenvio aplicado uma vez. Todos terminam conferindo que o saldo da carteira é igual à soma do ledger. Sem o `FOR UPDATE`, esses testes falham.

Os testes de referência cobrem cada tipo, cada código de falha, a regra de uma reversão por transação e a referência ausente. Um teste de concorrência envia um REFUND e um ROLLBACK da mesma BET ao mesmo tempo, por instâncias diferentes, e confere que só um é aplicado.

Atomicidade: se a outbox falha, carteira, transação e ledger ficam intactos.

Todo arquivo de teste termina conferindo que cada carteira tem saldo igual à soma do ledger. Os testes de processos sobem três `bun src/main.ts` reais no mesmo banco e filas, matam um processo entre o commit e o ack (failpoint `FAILPOINTS`, inerte sem a variável) e reiniciam no meio do trabalho, conferindo a consistência final. As migrações são revertidas e reaplicadas.

## Observabilidade

Logs em JSON (logger do Nest), com `correlationId`, `messageId`, `transactionId`, `walletId` e `providerId`; sem valores nem payloads. A única exceção é a diferença no aviso de divergência da reconciliação, que é o que precisa ser investigado. O `correlationId` vem do header `x-correlation-id` (ou é gerado), volta na resposta e vai para os eventos; na fila é o `messageId`.

Métricas em `/metrics`: transações por status, duplicatas, retries, DLQ, conflitos de lock, outbox lag, latência e divergências de reconciliação.

`/health/live` responde se o processo está de pé; `/health/ready` testa Postgres e SQS e responde 503 se algum estiver fora.

## Autenticação

Não implementada, como o enunciado permite. O desenho seria um IdP externo (ex.: Keycloak) com client credentials por provedor, conferindo que o `providerId` do token é o do corpo. O ponto de extensão é o `ProviderAuthGuard`, hoje sem efeito, aplicado às rotas de provedor.

## Interpretações adotadas

Pontos em que o enunciado é ambíguo ou não fala nada. Os detalhes estão nas seções indicadas.

- **Regra 4, reversão "pelo mesmo tipo":** uma reversão por transação, de qualquer tipo, para não haver crédito duplicado (Referências).
- **WIN e LOSS:** podem ter referência ou não, e só para BET; LOSS aceita `0.00` (Efeito de cada operação).
- **BET com referência, autorreferência e ROLLBACK de ROLLBACK:** recusados (Efeito de cada operação).
- **Referência pendente, recusada ou ausente:** espera, `REFERENCE_NOT_PROCESSED` ou `REFERENCE_NOT_FOUND` depois de ~5 min (Referências).
- **Status HTTP do replay:** o mesmo da primeira resposta, com `idempotentReplay: true`; uma pendente já resolvida devolve o estado atual (Idempotência, Referências).
- **Mesmo id externo com outra chave:** 409 `EXTERNAL_TRANSACTION_CONFLICT` (Idempotência).
- **`walletId` inexistente:** 404 no HTTP e DLQ com `WALLET_NOT_FOUND` na fila; nada é gravado, porque não há carteira onde gravar.
- **Status `PENDING`:** existe só dentro da transação SQL; a linha nasce PENDING e é atualizada antes do commit, então ninguém de fora a vê assim.
- **Status `FAILED`:** reservado. Falhas de infraestrutura fazem rollback e respondem 503, ou vão para a DLQ, sem gravar transação.
- **Comparar moedas diferentes:** `equals` devolve `false`; as contas lançam erro (Money).
- **Transação de abertura:** provedor `internal`, já `PROCESSED` (Transações).

## Trade-offs

- **Lock pessimista por carteira:** apostas na mesma carteira esperam em fila; em troca, a resposta é sempre a certa, sem repetição por conflito de versão.
- **Gravar PENDING e depois atualizar:** custa um UPDATE a mais, mas o `ON CONFLICT DO NOTHING` decide replay ou conflito antes de qualquer débito.
- **Workers por polling (1 s):** até ~1 s de atraso e uma consulta por segundo (barata, pelo índice parcial); em troca, funciona com várias instâncias sem coordenação.
- **Ordem dos eventos por carteira:** um evento que falha segura os seguintes da mesma carteira; as outras carteiras seguem.
- **Publisher segura o lock enquanto chama o SQS:** transação um pouco mais longa, mas nenhum outro publisher pega a mesma linha.
- **`decimal.js` em vez de `bigint` em centavos:** contas mais legíveis, ao custo de uma dependência e de configurar a precisão.
- **Recusar mais de 2 casas em vez de arredondar:** nenhum centavo inventado; o provedor precisa corrigir o payload.
- **Migrações geradas das entidades:** menos SQL à mão, mas o SQL gerado precisa ser revisado.
- **Um banco por arquivo de teste:** isolamento total, alguns segundos a mais por arquivo.

## Limitações conhecidas

- Autenticação não implementada (ver Autenticação).
- O banco não garante que a moeda da transação seja a da carteira, nem que a referência seja da mesma carteira; o caso de uso garante, dentro do lock. Uma FK composta `(wallet_id, currency)` fecharia isso no banco.
- Depois que um REFUND é desfeito por ROLLBACK, a BET não pode ser reembolsada de novo.
- A política de tentativas das referências pendentes é fixa no código; só o intervalo e o liga/desliga vêm do ambiente.
- Os testes de integração precisam do Postgres e do LocalStack de pé.
- Não há teste automatizado com o Postgres caindo no meio do processamento; o caminho é o mesmo do lock timeout (erro transitório → 503 ou nova entrega).

## Com mais tempo

- Ledger encadeado (hash do lançamento anterior em cada linha), para provar no banco que nada foi alterado.
- CI no GitHub Actions com Postgres e LocalStack.
- Teste de carga.
- FK composta para moeda e carteira da referência.
- Autenticação com um IdP externo.
