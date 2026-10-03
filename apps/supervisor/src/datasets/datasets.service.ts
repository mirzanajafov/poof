import { copyFile, link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Env } from '../config/env.js'

export interface DatasetItem {
  file: string
  width: number
  height: number
}

export interface Dataset {
  name: string
  items: DatasetItem[]
}

@Injectable()
export class Datasets {
  private readonly root: string
  private readonly cache = new Map<string, Dataset>()

  constructor(config: ConfigService<Env, true>) {
    this.root = config.get('DATA_DIR', { infer: true })
  }

  async get(name: string): Promise<Dataset> {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new NotFoundException(`no dataset ${name}`)
    const cached = this.cache.get(name)
    if (cached) return cached
    let raw: string
    try {
      raw = await readFile(join(this.root, 'datasets', name, 'manifest.json'), 'utf8')
    } catch {
      throw new NotFoundException(`no dataset ${name}`)
    }
    const dataset: Dataset = { name, items: (JSON.parse(raw) as { items: DatasetItem[] }).items }
    this.cache.set(name, dataset)
    return dataset
  }

  select(dataset: Dataset, offset: number, count: number): DatasetItem[] {
    return Array.from({ length: count }, (_, i) => dataset.items[(offset + i) % dataset.items.length]!)
  }

  taskDir(taskId: string): string {
    return join(this.root, 'tasks', taskId)
  }

  async createTask(taskId: string, dataset: Dataset, items: DatasetItem[]): Promise<string> {
    const dir = this.taskDir(taskId)
    await mkdir(join(dir, 'input'), { recursive: true })
    await mkdir(join(dir, 'out'), { recursive: true })
    const files: Array<{ file: string }> = []
    for (const [i, item] of items.entries()) {
      const file = `${i}-${basename(item.file)}`
      const source = join(this.root, 'datasets', dataset.name, item.file)
      const target = join(dir, 'input', file)
      await link(source, target).catch(() => copyFile(source, target))
      files.push({ file })
    }
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ items: files }))
    return dir
  }

  async removeTask(taskId: string): Promise<void> {
    await rm(this.taskDir(taskId), { recursive: true, force: true })
  }
}
