import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Injectable, NotFoundException } from '@nestjs/common'
import {
  datasetDir,
  datasetNamePattern,
  inputDir,
  manifestPath,
  outputDir,
  parseManifest,
  taskDir,
  tasksDir,
  type ManifestItem,
  type TaskManifest,
} from '@poof/contracts'
import { Env } from '../config/env.js'
import { linkOrCopy } from './files.js'

export interface Dataset {
  name: string
  items: ManifestItem[]
}

@Injectable()
export class Datasets {
  private readonly cache = new Map<string, Dataset>()

  constructor(private readonly env: Env) {}

  async get(name: string): Promise<Dataset> {
    if (!datasetNamePattern.test(name)) throw new NotFoundException(`no dataset ${name}`)
    const cached = this.cache.get(name)
    if (cached) return cached
    const path = manifestPath(datasetDir(this.env.DATA_DIR, name))
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
    const { items } = dataset
    return Array.from({ length: count }, (_, i) => {
      const item = items[(offset + i) % items.length]
      if (!item) throw new Error(`dataset ${dataset.name} has no items`)
      return item
    })
  }

  taskDir(taskId: string): string {
    return taskDir(this.env.DATA_DIR, taskId)
  }

  taskFolders(): Promise<string[]> {
    return readdir(tasksDir(this.env.DATA_DIR)).catch(() => [])
  }

  async createTask(taskId: string, dataset: Dataset, items: ManifestItem[]): Promise<void> {
    const dir = this.taskDir(taskId)
    await mkdir(inputDir(dir), { recursive: true })
    await mkdir(outputDir(dir), { recursive: true })
    const manifest: TaskManifest = { items: [] }
    for (const [i, item] of items.entries()) {
      const file = `${i}-${item.file}`
      await linkOrCopy(join(datasetDir(this.env.DATA_DIR, dataset.name), item.file), join(inputDir(dir), file))
      manifest.items.push({ file })
    }
    await writeFile(manifestPath(dir), JSON.stringify(manifest))
  }

  async removeTask(taskId: string): Promise<void> {
    await rm(this.taskDir(taskId), { recursive: true, force: true })
  }
}
