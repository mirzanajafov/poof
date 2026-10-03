import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Controller, Get } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Env } from '../config/env.js'
import { Cache, Database } from '../infra/infra.module.js'

interface Manifest {
  items: Array<{ width: number; height: number }>
}

@Controller()
export class StateController {
  private readonly dataDir: string

  constructor(
    private readonly cache: Cache,
    private readonly db: Database,
    config: ConfigService<Env, true>,
  ) {
    this.dataDir = config.get('DATA_DIR', { infer: true })
  }

  @Get('state')
  async state() {
    const [live, exhibit] = await Promise.all([this.cache.json('poof:live'), this.cache.json('poof:exhibit')])
    return { live, exhibit }
  }

  @Get('datasets')
  async datasets() {
    const root = join(this.dataDir, 'datasets')
    const names = await readdir(root).catch(() => [] as string[])
    const out = []
    for (const name of names.sort()) {
      const manifest = await readFile(join(root, name, 'manifest.json'), 'utf8')
        .then((raw) => JSON.parse(raw) as Manifest)
        .catch(() => null)
      if (!manifest) continue
      const mp = manifest.items.map((i) => (i.width * i.height) / 1e6)
      out.push({
        name,
        items: manifest.items.length,
        meanMp: Math.round((mp.reduce((s, v) => s + v, 0) / Math.max(1, mp.length)) * 10) / 10,
      })
    }
    return out
  }

  @Get('health')
  async health() {
    const [redis, db] = await Promise.all([
      this.cache.redis.ping().then(() => true).catch(() => false),
      this.db.client.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    ])
    return { ok: redis && db, redis, db }
  }
}
