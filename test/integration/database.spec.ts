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
});
