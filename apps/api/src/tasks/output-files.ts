import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Injectable } from '@nestjs/common'
import { outputFileName, presetNames } from '@poof/core'
import { Env } from '../config/env.js'

@Injectable()
export class OutputFiles {
  constructor(private readonly env: Env) {}

  async path(taskId: string, item: number): Promise<string | null> {
    for (const preset of presetNames) {
      const path = resolve(this.env.DATA_DIR, 'tasks', taskId, 'out', outputFileName(item, preset))
      const found = await stat(path).catch(() => null)
      if (found?.isFile()) return path
    }
    return null
  }
}
