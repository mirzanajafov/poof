import { Global, Module } from '@nestjs/common'
import { Database, TracingService } from '@poof/nest'
import { Env } from '../config/env.js'
import { LivePublisher } from './live-publisher.js'

@Global()
@Module({
  providers: [
    { provide: Database, useFactory: (env: Env) => new Database(env.DATABASE_URL), inject: [Env] },
    {
      provide: TracingService,
      useFactory: (env: Env) => new TracingService('poof-supervisor', env.OTEL_EXPORTER_OTLP_ENDPOINT),
      inject: [Env],
    },
    LivePublisher,
  ],
  exports: [Database, TracingService, LivePublisher],
})
export class InfraModule {}
