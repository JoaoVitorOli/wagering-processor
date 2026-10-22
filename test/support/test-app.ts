import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import {
  LOCK_TIMEOUT_MS,
  ORM_CONFIG,
} from '../../src/infra/database/database.module.js';
import { createOrmConfig } from '../../src/infra/database/mikro-orm.config.js';

export interface TestApp {
  url: string;
  close(): Promise<void>;
}

export interface TestAppOptions {
  lockTimeoutMs?: number;
}

export async function createTestApp(
  databaseName: string,
  options: TestAppOptions = {},
): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ORM_CONFIG)
    .useValue(createOrmConfig(databaseName))
    .overrideProvider(LOCK_TIMEOUT_MS)
    .useValue(options.lockTimeoutMs ?? 5000)
    .compile();

  const app: INestApplication = moduleRef.createNestApplication({
    logger: false,
  });
  await app.listen(0);

  return {
    url: await app.getUrl(),
    close: () => app.close(),
  };
}
