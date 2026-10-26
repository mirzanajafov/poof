import type { OnApplicationShutdown } from '@nestjs/common'
import { startTracing, type Tracer, type Tracing } from '@poof/tracing'

export class Traces implements OnApplicationShutdown {
  private readonly tracing: Tracing

  constructor(service: string, endpoint: string | undefined) {
    this.tracing = startTracing(service, { endpoint })
  }

  get tracer(): Tracer {
    return this.tracing.tracer
  }

  async onApplicationShutdown(): Promise<void> {
    await this.tracing.shutdown().catch(() => undefined)
  }
}
