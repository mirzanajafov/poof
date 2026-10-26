import { Global, Module } from '@nestjs/common'
import { Database, Traces } from '@poof/nest'
import { Env } from '../config/env.js'
import { Events } from './events.js'

@Global()
@Module({
  providers: [
    { provide: Database, useFactory: (env: Env) => new Database(env.DATABASE_URL), inject: [Env] },
    {
      provide: Traces,
      useFactory: (env: Env) => new Traces('poof-supervisor', env.OTEL_EXPORTER_OTLP_ENDPOINT),
      inject: [Env],
    },
    Events,
  ],
  exports: [Database, Traces, Events],
})
export class InfraModule {}
