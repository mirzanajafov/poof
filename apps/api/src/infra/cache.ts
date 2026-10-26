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
  readonly redis: Redis
  readonly url: string

  constructor(env: Env) {
    this.url = env.REDIS_URL
    this.redis = new Redis(this.url, { maxRetriesPerRequest: 2 })
    this.redis.on('error', () => undefined)
  }

  exhibitSnapshot(): Promise<ExhibitSnapshot | null> {
    return this.json<ExhibitSnapshot>(exhibitSnapshotKey)
  }

  async liveSnapshot(): Promise<LiveSnapshot> {
    const [live, exhibit] = await Promise.all([this.json<PoolSnapshot>(poolSnapshotKey), this.exhibitSnapshot()])
    return { live, exhibit }
  }

  private async json<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key).catch(() => null)
    return raw ? (JSON.parse(raw) as T) : null
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined)
  }
}
