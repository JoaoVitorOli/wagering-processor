import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { createOrmConfig } from './mikro-orm.config.js';

@Module({
  imports: [MikroOrmModule.forRoot(createOrmConfig())],
})
export class DatabaseModule {}
