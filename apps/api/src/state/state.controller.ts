import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Controller, Get } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { datasetNamePattern, parseManifest, type DatasetSummary, type LiveSnapshot } from '@poof/contracts'
import type { Env } from '../config/env.js'
import { Cache, Database } from '../infra/infra.module.js'

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
  state(): Promise<LiveSnapshot> {
    return this.cache.liveSnapshot()
  }

  @Get('datasets')
  async datasets(): Promise<DatasetSummary[]> {
    const root = join(this.dataDir, 'datasets')
    const names = await readdir(root).catch(() => [] as string[])
    const out: DatasetSummary[] = []
    for (const name of names.filter((n) => datasetNamePattern.test(n)).sort()) {
      const path = join(root, name, 'manifest.json')
      const manifest = await readFile(path, 'utf8')
        .then((text) => parseManifest(text, path))
        .catch(() => null)
      if (!manifest) continue
      const mp = manifest.items.map((i) => (i.width * i.height) / 1e6)
      out.push({
        name,
        items: manifest.items.length,
        meanMp: Math.round((mp.reduce((s, v) => s + v, 0) / mp.length) * 10) / 10,
      })
    }
    return out
  }

  @Get('health')
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
