import { Global, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createPrisma, PrismaClient } from '@poof/db'
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
    this.redis = new Redis(config.get('REDIS_URL', { infer: true }), { lazyConnect: false, maxRetriesPerRequest: 2 })
    this.redis.on('error', () => undefined)
  }

  publish(kind: string, payload: Record<string, unknown>): void {
    void this.redis.publish('poof:events', JSON.stringify({ kind, at: Date.now(), ...payload })).catch(() => undefined)
  }

  snapshot(key: string, value: unknown): void {
    void this.redis.set(key, JSON.stringify(value), 'EX', 30).catch(() => undefined)
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined)
  }
}

@Global()
@Module({ providers: [Database, Events], exports: [Database, Events] })
export class InfraModule {}
