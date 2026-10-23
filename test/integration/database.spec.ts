import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  createTestDatabase,
  type TestDatabase,
} from '../support/test-database.js';

describe('database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  it('connects to an isolated database', async () => {
    const [row] = await database.orm.em
      .getConnection()
      .execute<{ name: string }[]>('select current_database() as name');

    expect(row.name).toBe(database.name);
  });

  it('applies every migration', async () => {
    const pending = await database.orm.migrator.getPending();

    expect(pending).toHaveLength(0);
  });

  it('reverts every migration and applies them again', async () => {
    const tables = async () =>
      (
        await database.orm.em
          .getConnection()
          .execute<{ tablename: string }[]>(
            "select tablename from pg_tables where schemaname = 'public' and tablename <> 'mikro_orm_migrations' order by tablename",
          )
      ).map((row) => row.tablename);
    const before = await tables();

    await database.orm.migrator.down({ to: 0 });
    expect(await tables()).toEqual([]);

    await database.orm.migrator.up();
    expect(await tables()).toEqual(before);
    expect(await database.orm.migrator.getPending()).toHaveLength(0);
  });
});
