import { Global, Module } from '@nestjs/common'
import { Database, Traces } from '@poof/nest'
import { Env } from '../config/env.js'
import { Cache } from './cache.js'

@Global()
@Module({
  providers: [
    { provide: Database, useFactory: (env: Env) => new Database(env.DATABASE_URL), inject: [Env] },
    {
      provide: Traces,
      useFactory: (env: Env) => new Traces('poof-api', env.OTEL_EXPORTER_OTLP_ENDPOINT),
      inject: [Env],
    },
    Cache,
  ],
  exports: [Database, Traces, Cache],
})
export class InfraModule {}
