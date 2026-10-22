import { Migration } from '@mikro-orm/migrations';

export class Migration20261022140442 extends Migration {
  override name = 'Migration20261022140442';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "wallets" ("id" uuid not null, "player_id" uuid not null, "currency" char(3) not null, "balance" numeric(18,2) not null, "version" int not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `alter table "wallets" add constraint "wallets_player_id_currency_unique" unique ("player_id", "currency");`,
    );

    this.addSql(
      `create table "wager_transactions" ("id" uuid not null, "provider_id" varchar(255) not null, "external_transaction_id" varchar(255) not null, "idempotency_key" varchar(255) not null, "payload_hash" varchar(255) not null, "wallet_id" uuid not null, "player_id" uuid not null, "round_id" varchar(255) not null, "game_id" varchar(255) not null, "kind" text not null, "amount" numeric(18,2) not null, "currency" char(3) not null, "reference_external_transaction_id" varchar(255) null, "reference_transaction_id" uuid null, "status" text not null, "failure_code" varchar(255) null, "result_balance" numeric(18,2) null, "created_at" timestamptz not null, "processed_at" timestamptz null, primary key ("id"));`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key");`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_provider_id_external_transaction_id_unique" unique ("provider_id", "external_transaction_id");`,
    );
    this.addSql(
      `create unique index "wager_transactions_one_reversal_per_kind" on "wager_transactions" ("reference_transaction_id", "kind") where status = 'PROCESSED' and kind in ('REFUND', 'ROLLBACK');`,
    );

    this.addSql(
      `create table "wallet_ledger_entries" ("id" uuid not null, "sequence" bigserial, "wallet_id" uuid not null, "transaction_id" uuid not null, "direction" text not null, "amount" numeric(18,2) not null, "balance_before" numeric(18,2) not null, "balance_after" numeric(18,2) not null, "created_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_sequence_unique" unique ("sequence");`,
    );
    this.addSql(
      `create index "wallet_ledger_entries_wallet_id_sequence_index" on "wallet_ledger_entries" ("wallet_id", "sequence");`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_wallet_id_transaction_id_unique" unique ("wallet_id", "transaction_id");`,
    );

    this.addSql(
      `alter table "wallets" add constraint "wallets_currency_check" check (currency ~ '^[A-Z]{3}\$');`,
    );
    this.addSql(
      `alter table "wallets" add constraint "wallets_balance_check" check (balance >= 0);`,
    );
    this.addSql(
      `alter table "wallets" add constraint "wallets_version_check" check (version >= 1);`,
    );

    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_wallet_id_foreign" foreign key ("wallet_id") references "wallets" ("id");`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_reference_transaction_id_foreign" foreign key ("reference_transaction_id") references "wager_transactions" ("id") on delete no action;`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_currency_check" check (currency ~ '^[A-Z]{3}\$');`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_amount_check" check (amount > 0 or (kind = 'LOSS' and amount = 0));`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_result_balance_check" check (result_balance >= 0);`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_reversal_reference_check" check (kind not in ('REFUND', 'ROLLBACK') or reference_external_transaction_id is not null);`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_no_reference_check" check (kind not in ('OPENING', 'BET') or reference_external_transaction_id is null);`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_self_reference_check" check (reference_external_transaction_id <> external_transaction_id);`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_failure_code_check" check ((status in ('REJECTED', 'FAILED')) = (failure_code is not null));`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_processed_at_check" check ((status in ('PROCESSED', 'REJECTED', 'FAILED')) = (processed_at is not null));`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_result_balance_required_check" check (status not in ('PENDING_REFERENCE', 'PROCESSED', 'REJECTED') or result_balance is not null);`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_reversal_resolved_check" check (status <> 'PROCESSED' or kind not in ('REFUND', 'ROLLBACK') or reference_transaction_id is not null);`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_kind_check" check ("kind" in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'));`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_status_check" check ("status" in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED'));`,
    );

    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_wallet_id_foreign" foreign key ("wallet_id") references "wallets" ("id");`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_transaction_id_foreign" foreign key ("transaction_id") references "wager_transactions" ("id");`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_amount_check" check (amount > 0);`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_balance_before_check" check (balance_before >= 0);`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_balance_after_check" check (balance_after >= 0);`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_balanced_check" check ((direction = 'CREDIT' and balance_after = balance_before + amount) or (direction = 'DEBIT' and balance_after = balance_before - amount));`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_direction_check" check ("direction" in ('DEBIT', 'CREDIT'));`,
    );
    this.addSql(
      `create or replace function "wallet_ledger_entries_prevent_update_delete_fn"() returns trigger as \$\$ begin raise exception 'wallet_ledger_entries is append-only'; return null; end; \$\$ language plpgsql;`,
    );
    this.addSql(
      `create trigger "prevent_update_delete" BEFORE UPDATE OR DELETE on "wallet_ledger_entries" for each ROW execute function "wallet_ledger_entries_prevent_update_delete_fn"();`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table "wager_transactions" drop constraint "wager_transactions_wallet_id_foreign";`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" drop constraint "wallet_ledger_entries_wallet_id_foreign";`,
    );
    this.addSql(
      `alter table "wager_transactions" drop constraint "wager_transactions_reference_transaction_id_foreign";`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" drop constraint "wallet_ledger_entries_transaction_id_foreign";`,
    );

    this.addSql(`drop table if exists "wallets" cascade;`);
    this.addSql(`drop table if exists "wager_transactions" cascade;`);
    this.addSql(
      `drop trigger if exists "prevent_update_delete" on "wallet_ledger_entries";`,
    );
    this.addSql(
      `drop function if exists "wallet_ledger_entries_prevent_update_delete_fn"();`,
    );
    this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);
  }
}
