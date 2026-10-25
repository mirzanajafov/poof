import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { datasetNamePattern, parseManifest, type ManifestItem, type TaskManifest } from '@poof/contracts'
import type { Env } from '../config/env.js'
import { linkOrCopy } from './link-or-copy.js'

export interface Dataset {
  name: string
  items: ManifestItem[]
}

@Injectable()
export class Datasets {
  private readonly root: string
  private readonly cache = new Map<string, Dataset>()

  constructor(config: ConfigService<Env, true>) {
    this.root = config.get('DATA_DIR', { infer: true })
  }

  async get(name: string): Promise<Dataset> {
    if (!datasetNamePattern.test(name)) throw new NotFoundException(`no dataset ${name}`)
    const cached = this.cache.get(name)
    if (cached) return cached
    const path = join(this.root, 'datasets', name, 'manifest.json')
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      throw new NotFoundException(`no dataset ${name}`)
    }
    const dataset: Dataset = { name, items: parseManifest(text, path).items }
    this.cache.set(name, dataset)
    return dataset
  }

  select(dataset: Dataset, offset: number, count: number): ManifestItem[] {
    return Array.from({ length: count }, (_, i) => dataset.items[(offset + i) % dataset.items.length]!)
  }

  taskDir(taskId: string): string {
    return join(this.root, 'tasks', taskId)
  }

  async createTask(taskId: string, dataset: Dataset, items: ManifestItem[]): Promise<string> {
    const dir = this.taskDir(taskId)
    await mkdir(join(dir, 'input'), { recursive: true })
    await mkdir(join(dir, 'out'), { recursive: true })
    const manifest: TaskManifest = { items: [] }
    for (const [i, item] of items.entries()) {
      const file = `${i}-${item.file}`
      await linkOrCopy(join(this.root, 'datasets', dataset.name, item.file), join(dir, 'input', file))
      manifest.items.push({ file })
    }
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest))
    return dir
  }

  async removeTask(taskId: string): Promise<void> {
    await rm(this.taskDir(taskId), { recursive: true, force: true })
  }
}
