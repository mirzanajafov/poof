import { readFile } from 'node:fs/promises'
import { Injectable, Logger } from '@nestjs/common'
import {
  datasetDir,
  datasetNamePattern,
  datasetsDir,
  manifestPath,
  parseManifest,
  type DatasetSummary,
} from '@poof/contracts'
import { isMissingFile, readDirIfPresent } from '@poof/nest'
import { Env } from '../config/env.js'

@Injectable()
export class Datasets {
  private readonly logger = new Logger(Datasets.name)
  private readonly skipped = new Set<string>()

  constructor(private readonly env: Env) {}

  async list(): Promise<DatasetSummary[]> {
    const names = await readDirIfPresent(datasetsDir(this.env.DATA_DIR))
    const valid = names.filter((name) => datasetNamePattern.test(name)).sort()
    const summaries = await Promise.all(valid.map((name) => this.summary(name)))
    return summaries.filter((summary) => summary !== null)
  }

  private async summary(name: string): Promise<DatasetSummary | null> {
    const path = manifestPath(datasetDir(this.env.DATA_DIR, name))
    const manifest = await readFile(path, 'utf8')
      .then((text) => parseManifest(text, path))
      .catch((error: unknown) => {
        if (!isMissingFile(error) && !this.skipped.has(name)) {
          this.skipped.add(name)
          this.logger.warn(`skipping dataset ${name}`, error)
        }
        return null
      })
    if (!manifest) return null
    const mp = manifest.items.map((i) => (i.width * i.height) / 1e6)
    return {
      name,
      items: manifest.items.length,
      meanMp: Math.round((mp.reduce((s, v) => s + v, 0) / mp.length) * 10) / 10,
    }
  }
}
