import { SetMetadata } from '@nestjs/common'

export const LIMIT = 'poof:limit'

export interface Limit {
  name: string
  setting: 'TASKS_PER_MINUTE' | 'EXHIBITS_PER_HOUR'
  windowSeconds: number
}

export const RateLimit = (limit: Limit) => SetMetadata(LIMIT, limit)
