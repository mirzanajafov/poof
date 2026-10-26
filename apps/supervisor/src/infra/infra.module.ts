import { Global, Module } from '@nestjs/common'
import { Database, Telemetry } from '@poof/nest'
import { Env } from '../config/env.js'
import { LivePublisher } from './live-publisher.js'

@Global()
@Module({
  providers: [
    { provide: Database, useFactory: (env: Env) => new Database(env.DATABASE_URL), inject: [Env] },
    {
      provide: Telemetry,
      useFactory: (env: Env) => new Telemetry('poof-supervisor', env.OTEL_EXPORTER_OTLP_ENDPOINT),
      inject: [Env],
    },
    LivePublisher,
  ],
  exports: [Database, Telemetry, LivePublisher],
})
export class InfraModule {}
