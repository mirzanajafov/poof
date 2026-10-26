import { Logger } from '@nestjs/common'
import { Redis, type RedisOptions } from 'ioredis'

export function connectRedis(url: string, name: string, options: RedisOptions = {}): Redis {
  const logger = new Logger(name)
  const redis = new Redis(url, { maxRetriesPerRequest: 2, ...options })
  let down = false
  redis.on('error', (error: Error) => {
    if (!down) logger.warn(`Redis is unreachable: ${error.message}`)
    down = true
  })
  redis.on('ready', () => {
    if (down) logger.log('Redis is back')
    down = false
  })
  return redis
}

export async function closeRedis(redis: Redis): Promise<void> {
  if (redis.status === 'ready') await redis.quit()
  else redis.disconnect()
}
