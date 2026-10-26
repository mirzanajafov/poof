import { Controller, Get } from '@nestjs/common'
import type { LiveSnapshot } from '@poof/contracts'
import { Cache } from '../infra/cache.js'

@Controller('state')
export class LiveController {
  constructor(private readonly cache: Cache) {}

  @Get()
  state(): Promise<LiveSnapshot> {
    return this.cache.liveSnapshot()
  }
}
