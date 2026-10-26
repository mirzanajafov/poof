import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common'
import {
  exhibitSnapshotKey,
  liveEventsChannel,
  poolSnapshotKey,
  type ExhibitSnapshot,
  type LiveEventBody,
  type PoolSnapshot,
} from '@poof/contracts'
import { closeRedis, connectRedis, FailureStreak } from '@poof/nest'
import type { Redis } from 'ioredis'
import { Env } from '../config/env.js'

@Injectable()
export class Events implements OnApplicationShutdown {
  private readonly redis: Redis
  private readonly writes = new FailureStreak(new Logger(Events.name), 'writing the live view to Redis')

  constructor(env: Env) {
    this.redis = connectRedis(env.REDIS_URL, Events.name)
  }

  publish(event: LiveEventBody): void {
    this.run(this.redis.publish(liveEventsChannel, JSON.stringify({ ...event, at: Date.now() })))
  }

  savePoolSnapshot(snapshot: PoolSnapshot): void {
    this.save(poolSnapshotKey, snapshot)
  }

  saveExhibitSnapshot(snapshot: ExhibitSnapshot): void {
    this.save(exhibitSnapshotKey, snapshot)
  }

  clearExhibitSnapshot(): void {
    this.run(this.redis.del(exhibitSnapshotKey))
  }

  private save(key: string, value: PoolSnapshot | ExhibitSnapshot): void {
    this.run(this.redis.set(key, JSON.stringify(value), 'EX', 30))
  }

  private run(command: Promise<unknown>): void {
    command.then(
      () => {
        this.writes.succeeded()
      },
      (error: unknown) => {
        this.writes.failed(error)
      },
    )
  }

  async onApplicationShutdown(): Promise<void> {
    await closeRedis(this.redis)
  }
}
