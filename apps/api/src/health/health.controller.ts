import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { Database } from '@poof/nest'
import { RedisStore } from '../infra/redis-store.js'

@Controller('health')
export class HealthController {
  constructor(
    private readonly store: RedisStore,
    private readonly db: Database,
  ) {}

  @Get()
  async health() {
    const [redis, db] = await Promise.all([this.store.ping(), this.db.ping()])
    const health = { ok: redis && db, redis, db }
    if (!health.ok) throw new ServiceUnavailableException(health)
    return health
  }
}
