import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';

export function createOrmConfig(dbName = process.env.POSTGRES_DB) {
  return defineConfig({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    dbName,
    entities: [],
    discovery: { warnWhenNoEntities: false },
    extensions: [Migrator],
    migrations: {
      path: 'src/infra/database/migrations',
      pathTs: 'src/infra/database/migrations',
      snapshot: false,
      transactional: true,
      allOrNothing: true,
    },
  });
}

export default createOrmConfig();
