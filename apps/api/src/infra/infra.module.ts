import { Global, Module } from '@nestjs/common'
import { Database, Telemetry } from '@poof/nest'
import { Env } from '../config/env.js'
import { RedisStore } from './redis-store.js'

@Global()
@Module({
  providers: [
    { provide: Database, useFactory: (env: Env) => new Database(env.DATABASE_URL), inject: [Env] },
    {
      provide: Telemetry,
      useFactory: (env: Env) => new Telemetry('poof-api', env.OTEL_EXPORTER_OTLP_ENDPOINT),
      inject: [Env],
    },
    RedisStore,
  ],
  exports: [Database, Telemetry, RedisStore],
})
export class InfraModule {}
