import { Controller, Get } from '@nestjs/common'
import { Database } from '@poof/nest'
import { Cache } from './cache.js'

@Controller('health')
export class HealthController {
  constructor(
    private readonly cache: Cache,
    private readonly db: Database,
  ) {}

  @Get()
  async health() {
    const [redis, db] = await Promise.all([
      this.cache.redis
        .ping()
        .then(() => true)
        .catch(() => false),
      this.db.client.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    ])
    return { ok: redis && db, redis, db }
  }
}
