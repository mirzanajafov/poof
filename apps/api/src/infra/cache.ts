import { Injectable, type OnApplicationShutdown } from '@nestjs/common'
import {
  exhibitSnapshotKey,
  poolSnapshotKey,
  type ExhibitSnapshot,
  type LiveSnapshot,
  type PoolSnapshot,
} from '@poof/contracts'
import { Redis } from 'ioredis'
import { Env } from '../config/env.js'

@Injectable()
export class Cache implements OnApplicationShutdown {
  private readonly redis: Redis
  private subscriber: Redis | null = null

  constructor(env: Env) {
    this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 })
    this.redis.on('error', () => undefined)
  }

  exhibitSnapshot(): Promise<ExhibitSnapshot | null> {
    return this.json<ExhibitSnapshot>(exhibitSnapshotKey)
  }

  async liveSnapshot(): Promise<LiveSnapshot> {
    const [live, exhibit] = await Promise.all([this.json<PoolSnapshot>(poolSnapshotKey), this.exhibitSnapshot()])
    return { live, exhibit }
  }

  ping(): Promise<boolean> {
    return this.redis.ping().then(
      () => true,
      () => false,
    )
  }

  async count(key: string, windowMs: number): Promise<number> {
    const results = await this.redis.multi().incr(key).pexpire(key, windowMs).exec()
    return Number(results?.[0]?.[1] ?? 0)
  }

  async claim(key: string, seconds: number): Promise<boolean> {
    return (await this.redis.set(key, '1', 'EX', seconds, 'NX')) === 'OK'
  }

  ttl(key: string): Promise<number> {
    return this.redis.ttl(key)
  }

  async release(key: string): Promise<void> {
    await this.redis.del(key)
  }

  subscribe(channel: string, onMessage: (message: string) => void): void {
    this.subscriber = this.redis.duplicate({ maxRetriesPerRequest: null })
    this.subscriber.on('error', () => undefined)
    this.subscriber.on('message', (_channel: string, message: string) => {
      onMessage(message)
    })
    void this.subscriber.subscribe(channel).catch(() => undefined)
  }

  private async json<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key).catch(() => null)
    return raw ? (JSON.parse(raw) as T) : null
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.redis.quit(), this.subscriber?.quit()]).catch(() => undefined)
  }
}
