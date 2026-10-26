import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Controller, Get } from '@nestjs/common'
import { datasetNamePattern, parseManifest, type DatasetSummary } from '@poof/contracts'
import { Env } from '../config/env.js'

@Controller('datasets')
export class DatasetsController {
  private readonly dataDir: string

  constructor(env: Env) {
    this.dataDir = env.DATA_DIR
  }

  @Get()
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
}
