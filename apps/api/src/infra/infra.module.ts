import { Global, Module } from '@nestjs/common'
import { Database, TracingService } from '@poof/nest'
import { Env } from '../config/env.js'
import { RedisStore } from './redis-store.js'

@Global()
@Module({
  providers: [
    { provide: Database, useFactory: (env: Env) => new Database(env.DATABASE_URL), inject: [Env] },
    {
      provide: TracingService,
      useFactory: (env: Env) => new TracingService('poof-api', env.OTEL_EXPORTER_OTLP_ENDPOINT),
      inject: [Env],
    },
    RedisStore,
  ],
  exports: [Database, TracingService, RedisStore],
})
export class InfraModule {}
