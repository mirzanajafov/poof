import { resolve } from 'node:path'
import { Injectable } from '@nestjs/common'
import { isPresetName, presetExtensions } from '@poof/core'
import { Database } from '@poof/nest'
import { Env } from '../config/env.js'

@Injectable()
export class OutputFiles {
  constructor(
    private readonly db: Database,
    private readonly env: Env,
  ) {}

  async path(taskId: string, item: number): Promise<string | null> {
    const task = await this.db.client.task.findUnique({ where: { id: taskId }, select: { preset: true } })
    if (!task || !isPresetName(task.preset)) return null
    return resolve(this.env.DATA_DIR, 'tasks', taskId, 'out', `${item}.${presetExtensions[task.preset]}`)
  }
}
