import { Logger } from '@nestjs/common'
import { Redis, type RedisOptions } from 'ioredis'
import { FailureStreak } from './failure-streak.ts'

export function connectRedis(url: string, name: string, options: RedisOptions = {}): Redis {
  const connection = new FailureStreak(new Logger(name), 'the Redis connection')
  const redis = new Redis(url, { maxRetriesPerRequest: 2, ...options })
  redis.on('error', (error: Error) => {
    connection.failed(error)
  })
  redis.on('ready', () => {
    connection.succeeded()
  })
  return redis
}

export async function closeRedis(redis: Redis): Promise<void> {
  if (redis.status !== 'ready') {
    redis.disconnect()
    return
  }
  await redis.quit().catch((error: unknown) => {
    new Logger('Redis').warn('could not close a connection cleanly', error)
  })
}
