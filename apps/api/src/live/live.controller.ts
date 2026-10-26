import { Controller, Get } from '@nestjs/common'
import type { LiveSnapshot } from '@poof/contracts'
import { RedisStore } from '../infra/redis-store.js'

@Controller('state')
export class LiveController {
  constructor(private readonly store: RedisStore) {}

  @Get()
  state(): Promise<LiveSnapshot> {
    return this.store.liveSnapshot()
  }
}
