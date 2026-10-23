import { Migration } from '@mikro-orm/migrations';

export class Migration20261023005710_reference_retries extends Migration {
  override name = 'Migration20261023005710_reference_retries';

  override up(): void | Promise<void> {
    this.addSql(
      `alter table "wager_transactions" add "reference_attempts" int not null default 0, add "next_reference_attempt_at" timestamptz null;`,
    );
    this.addSql(
      `update "wager_transactions" set "next_reference_attempt_at" = now() where "status" = 'PENDING_REFERENCE';`,
    );
    this.addSql(
      `create index "wager_transactions_pending_reference_index" on "wager_transactions" ("next_reference_attempt_at") where status = 'PENDING_REFERENCE';`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_reference_attempts_check" check (reference_attempts >= 0);`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_next_reference_attempt_check" check ((status = 'PENDING_REFERENCE') = (next_reference_attempt_at is not null));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "wager_transactions_pending_reference_index";`);
    this.addSql(
      `alter table "wager_transactions" drop constraint "wager_transactions_reference_attempts_check";`,
    );
    this.addSql(
      `alter table "wager_transactions" drop constraint "wager_transactions_next_reference_attempt_check";`,
    );
    this.addSql(
      `alter table "wager_transactions" drop column "reference_attempts", drop column "next_reference_attempt_at";`,
    );
  }
}
