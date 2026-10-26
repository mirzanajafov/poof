import { Injectable, type OnApplicationShutdown } from '@nestjs/common'
import {
  exhibitSnapshotKey,
  liveEventsChannel,
  poolSnapshotKey,
  type ExhibitSnapshot,
  type LiveEventBody,
  type PoolSnapshot,
} from '@poof/contracts'
import { closeRedis, connectRedis } from '@poof/nest'
import type { Redis } from 'ioredis'
import { Env } from '../config/env.js'

@Injectable()
export class Events implements OnApplicationShutdown {
  private readonly redis: Redis

  constructor(env: Env) {
    this.redis = connectRedis(env.REDIS_URL, Events.name)
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
    await closeRedis(this.redis).catch(() => undefined)
  }
}
