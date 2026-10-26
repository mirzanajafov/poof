import { Injectable, type OnApplicationShutdown } from '@nestjs/common'
import {
  exhibitSnapshotKey,
  poolSnapshotKey,
  type ExhibitSnapshot,
  type LiveSnapshot,
  type PoolSnapshot,
} from '@poof/contracts'
import { closeRedis, connectRedis, UnavailableError } from '@poof/nest'
import type { Redis } from 'ioredis'
import { Env } from '../config/env.js'

@Injectable()
export class Cache implements OnApplicationShutdown {
  private readonly redis: Redis
  private subscriber: Redis | null = null

  constructor(private readonly env: Env) {
    this.redis = connectRedis(env.REDIS_URL, Cache.name)
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

  async increment(key: string, windowMs: number): Promise<number> {
    const results = await unavailableOnFailure(this.redis.multi().incr(key).pexpire(key, windowMs).exec())
    const [error, count] = results?.[0] ?? [new Error('the transaction was discarded'), null]
    if (error) throw new UnavailableError('the rate limiter is unavailable', { cause: error })
    return Number(count)
  }

  async claim(key: string, seconds: number): Promise<{ claimed: true } | { claimed: false; ttlSeconds: number }> {
    if ((await unavailableOnFailure(this.redis.set(key, '1', 'EX', seconds, 'NX'))) === 'OK') return { claimed: true }
    return { claimed: false, ttlSeconds: Math.max(1, await unavailableOnFailure(this.redis.ttl(key))) }
  }

  async release(key: string): Promise<void> {
    await unavailableOnFailure(this.redis.del(key))
  }

  subscribe(channel: string, onMessage: (message: string) => void): void {
    this.subscriber ??= connectRedis(this.env.REDIS_URL, `${Cache.name} subscriber`, { maxRetriesPerRequest: null })
    this.subscriber.on('message', (received: string, message: string) => {
      if (received === channel) onMessage(message)
    })
    void this.subscriber.subscribe(channel).catch(() => undefined)
  }

  private async json<T>(key: string): Promise<T | null> {
    const raw = await unavailableOnFailure(this.redis.get(key))
    return raw ? (JSON.parse(raw) as T) : null
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([closeRedis(this.redis), this.subscriber && closeRedis(this.subscriber)])
  }
}

function unavailableOnFailure<T>(command: Promise<T>): Promise<T> {
  return command.catch((error: unknown) => {
    throw new UnavailableError('the live store is unavailable', { cause: error })
  })
}
