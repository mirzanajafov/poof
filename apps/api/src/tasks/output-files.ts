import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Injectable } from '@nestjs/common'
import { outputFileName, presetNames } from '@poof/core'
import { Env } from '../config/env.js'

export interface OutputFile {
  dir: string
  name: string
}

@Injectable()
export class OutputFiles {
  constructor(private readonly env: Env) {}

  async find(taskId: string, item: number): Promise<OutputFile | null> {
    const dir = join(this.env.DATA_DIR, 'tasks', taskId, 'out')
    const names = presetNames.map((preset) => outputFileName(item, preset))
    const found = await Promise.all(
      names.map((name) =>
        stat(join(dir, name)).then(
          (s) => s.isFile(),
          () => false,
        ),
      ),
    )
    const name = names.find((_, i) => found[i])
    return name === undefined ? null : { dir, name }
  }
}
