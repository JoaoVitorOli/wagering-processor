import { Migration } from '@mikro-orm/migrations';

export class Migration20261022233502_one_reversal_per_reference extends Migration {
  override name = 'Migration20261022233502_one_reversal_per_reference';

  override up(): void | Promise<void> {
    this.addSql(`drop index "wager_transactions_one_reversal_per_kind";`);
    this.addSql(
      `create unique index "wager_transactions_one_reversal_per_reference" on "wager_transactions" ("reference_transaction_id") where status = 'PROCESSED' and kind in ('REFUND', 'ROLLBACK');`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "wager_transactions_one_reversal_per_reference";`);
    this.addSql(
      `create unique index "wager_transactions_one_reversal_per_kind" on "wager_transactions" ("reference_transaction_id", "kind") where status = 'PROCESSED' and kind in ('REFUND', 'ROLLBACK');`,
    );
  }
}
