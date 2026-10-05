import { Global, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createPrisma, PrismaClient } from '@poof/db'
import { startTracing, type Tracer, type Tracing } from '@poof/tracing'
import { Redis } from 'ioredis'
import type { Env } from '../config/env.js'

@Injectable()
export class Database implements OnApplicationShutdown {
  readonly client: PrismaClient

  constructor(config: ConfigService<Env, true>) {
    this.client = createPrisma(config.get('DATABASE_URL', { infer: true }))
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect()
  }
}

@Injectable()
export class Cache implements OnApplicationShutdown {
  readonly redis: Redis
  readonly url: string

  constructor(config: ConfigService<Env, true>) {
    this.url = config.get('REDIS_URL', { infer: true })
    this.redis = new Redis(this.url, { maxRetriesPerRequest: 2 })
    this.redis.on('error', () => undefined)
  }

  async json<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key).catch(() => null)
    return raw ? (JSON.parse(raw) as T) : null
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined)
  }
}

@Global()
@Injectable()
export class Traces implements OnApplicationShutdown {
  private readonly tracing: Tracing

  constructor(config: ConfigService<Env, true>) {
    this.tracing = startTracing('poof-api', { endpoint: config.get('OTEL_EXPORTER_OTLP_ENDPOINT', { infer: true }) })
  }

  get tracer(): Tracer {
    return this.tracing.tracer
  }

  async onApplicationShutdown(): Promise<void> {
    await this.tracing.shutdown().catch(() => undefined)
  }
}

@Module({ providers: [Database, Cache, Traces], exports: [Database, Cache, Traces] })
export class InfraModule {}
