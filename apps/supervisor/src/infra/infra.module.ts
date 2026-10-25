import { Global, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  exhibitSnapshotKey,
  liveEventsChannel,
  poolSnapshotKey,
  type ExhibitSnapshot,
  type LiveEventBody,
  type PoolSnapshot,
} from '@poof/contracts'
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
export class Events implements OnApplicationShutdown {
  private readonly redis: Redis

  constructor(config: ConfigService<Env, true>) {
    this.redis = new Redis(config.get('REDIS_URL', { infer: true }), { maxRetriesPerRequest: 2 })
    this.redis.on('error', () => undefined)
  }

  publish(event: LiveEventBody): void {
    void this.redis.publish(liveEventsChannel, JSON.stringify({ ...event, at: Date.now() })).catch(() => undefined)
  }

  savePoolSnapshot(snapshot: PoolSnapshot): void {
    this.save(poolSnapshotKey, snapshot)
  }

  saveExhibitSnapshot(snapshot: ExhibitSnapshot): void {
    this.save(exhibitSnapshotKey, snapshot)
  }

  clearExhibitSnapshot(): void {
    void this.redis.del(exhibitSnapshotKey).catch(() => undefined)
  }

  private save(key: string, value: PoolSnapshot | ExhibitSnapshot): void {
    void this.redis.set(key, JSON.stringify(value), 'EX', 30).catch(() => undefined)
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined)
  }
}

@Injectable()
export class Traces implements OnApplicationShutdown {
  private readonly tracing: Tracing

  constructor(config: ConfigService<Env, true>) {
    this.tracing = startTracing('poof-supervisor', {
      endpoint: config.get('OTEL_EXPORTER_OTLP_ENDPOINT', { infer: true }),
    })
  }

  get tracer(): Tracer {
    return this.tracing.tracer
  }

  async onApplicationShutdown(): Promise<void> {
    await this.tracing.shutdown().catch(() => undefined)
  }
}

@Global()
@Module({ providers: [Database, Events, Traces], exports: [Database, Events, Traces] })
export class InfraModule {}
