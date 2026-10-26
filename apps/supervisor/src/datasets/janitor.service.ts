import { stat } from 'node:fs/promises'
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common'
import type { Task } from '@poof/db'
import { Database, isMissingFile } from '@poof/nest'
import { Env } from '../config/env.js'
import { Datasets } from './datasets.service.js'

type SweptTask = Pick<Task, 'status' | 'submittedAt' | 'finishedAt'>

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

@Injectable()
export class Janitor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(Janitor.name)
  private readonly ttlMs: number
  private timer: NodeJS.Timeout | null = null

  constructor(
    env: Env,
    private readonly db: Database,
    private readonly datasets: Datasets,
  ) {
    this.ttlMs = env.OUTPUT_TTL_HOURS * 3_600_000
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => {
        this.sweep().catch((error: unknown) => {
          this.logger.error('the output sweep failed', error)
        })
      },
      Math.min(10 * 60_000, this.ttlMs / 4),
    )
    this.timer.unref()
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async sweep(now = Date.now()): Promise<number> {
    const names = (await this.datasets.taskFolders()).filter((name) => uuid.test(name))
    if (names.length === 0) return 0
    const tasks = await this.db.client.task.findMany({
      where: { id: { in: names } },
      select: { id: true, status: true, submittedAt: true, finishedAt: true },
    })
    const known = new Map(tasks.map((t) => [t.id, t]))
    let removed = 0
    for (const name of names) {
      try {
        if (await this.expire(name, known.get(name), now)) removed++
      } catch (error) {
        this.logger.error(`could not remove the outputs of task ${name}`, error)
      }
    }
    if (removed > 0) this.logger.log(`removed the outputs of ${removed} tasks`)
    return removed
  }

  private async expire(name: string, task: SweptTask | undefined, now: number): Promise<boolean> {
    if (task?.status === 'QUEUED' || task?.status === 'RUNNING') return false
    const ended = task ? (task.finishedAt ?? task.submittedAt).getTime() : await this.createdAt(name)
    if (ended === null || now - ended < this.ttlMs) return false
    await this.datasets.removeTask(name)
    return true
  }

  private async createdAt(name: string): Promise<number | null> {
    const info = await stat(this.datasets.taskDir(name)).catch((error: unknown) => {
      if (isMissingFile(error)) return null
      throw error
    })
    return info ? info.mtimeMs : null
  }
}
