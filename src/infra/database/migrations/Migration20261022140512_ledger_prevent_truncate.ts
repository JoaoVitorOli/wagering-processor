import { Migration } from '@mikro-orm/migrations';

export class Migration20261022140512_ledger_prevent_truncate extends Migration {
  override name = 'Migration20261022140512_ledger_prevent_truncate';

  override up(): void | Promise<void> {
    this.addSql(
      `create function "wallet_ledger_entries_prevent_truncate_fn"() returns trigger as $$ begin raise exception 'wallet_ledger_entries is append-only'; end; $$ language plpgsql;`,
    );
    this.addSql(
      `create trigger "prevent_truncate" before truncate on "wallet_ledger_entries" for each statement execute function "wallet_ledger_entries_prevent_truncate_fn"();`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(
      `drop trigger if exists "prevent_truncate" on "wallet_ledger_entries";`,
    );
    this.addSql(
      `drop function if exists "wallet_ledger_entries_prevent_truncate_fn"();`,
    );
  }
}
