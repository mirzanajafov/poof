import { Controller, Get } from '@nestjs/common'
import { Database } from '@poof/nest'
import { Cache } from '../infra/cache.js'

@Controller('health')
export class HealthController {
  constructor(
    private readonly cache: Cache,
    private readonly db: Database,
  ) {}

  @Get()
  async health() {
    const [redis, db] = await Promise.all([this.cache.ping(), this.db.ping()])
    return { ok: redis && db, redis, db }
  }
}
