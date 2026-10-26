import { readdir, readFile } from 'node:fs/promises'
import { Injectable } from '@nestjs/common'
import {
  datasetDir,
  datasetNamePattern,
  datasetsDir,
  manifestPath,
  parseManifest,
  type DatasetSummary,
} from '@poof/contracts'
import { Env } from '../config/env.js'

@Injectable()
export class Datasets {
  constructor(private readonly env: Env) {}

  async list(): Promise<DatasetSummary[]> {
    const names = await readdir(datasetsDir(this.env.DATA_DIR)).catch(() => [] as string[])
    const valid = names.filter((name) => datasetNamePattern.test(name)).sort()
    const summaries = await Promise.all(valid.map((name) => this.summary(name)))
    return summaries.filter((summary) => summary !== null)
  }

  private async summary(name: string): Promise<DatasetSummary | null> {
    const path = manifestPath(datasetDir(this.env.DATA_DIR, name))
    const manifest = await readFile(path, 'utf8')
      .then((text) => parseManifest(text, path))
      .catch(() => null)
    if (!manifest) return null
    const mp = manifest.items.map((i) => (i.width * i.height) / 1e6)
    return {
      name,
      items: manifest.items.length,
      meanMp: Math.round((mp.reduce((s, v) => s + v, 0) / mp.length) * 10) / 10,
    }
  }
}
