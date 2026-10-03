import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Env } from '../config/env.js'
import { Database } from '../infra/infra.module.js'
import { Datasets } from './datasets.service.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

@Injectable()
export class Janitor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(Janitor.name)
  private readonly ttlMs: number
  private readonly root: string
  private timer: NodeJS.Timeout | null = null

  constructor(
    config: ConfigService<Env, true>,
    private readonly db: Database,
    private readonly datasets: Datasets,
  ) {
    this.ttlMs = config.get('OUTPUT_TTL_HOURS', { infer: true }) * 3_600_000
    this.root = join(config.get('DATA_DIR', { infer: true }), 'tasks')
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sweep(), Math.min(10 * 60_000, this.ttlMs / 4))
    this.timer.unref()
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async sweep(now = Date.now()): Promise<number> {
    const names = (await readdir(this.root).catch(() => [] as string[])).filter((name) => uuid.test(name))
    if (names.length === 0) return 0
    const tasks = await this.db.client.task.findMany({
      where: { id: { in: names } },
      select: { id: true, status: true, submittedAt: true, finishedAt: true },
    })
    const known = new Map(tasks.map((t) => [t.id, t]))
    let removed = 0
    for (const name of names) {
      const task = known.get(name)
      const open = task && (task.status === 'QUEUED' || task.status === 'RUNNING')
      const ended = task ? (task.finishedAt ?? task.submittedAt).getTime() : await this.createdAt(name)
      if (open || ended === null || now - ended < this.ttlMs) continue
      await this.datasets.removeTask(name)
      removed++
    }
    if (removed > 0) this.logger.log(`removed the outputs of ${removed} tasks`)
    return removed
  }

  private async createdAt(name: string): Promise<number | null> {
    const info = await stat(join(this.root, name)).catch(() => null)
    return info ? info.mtimeMs : null
  }
}
