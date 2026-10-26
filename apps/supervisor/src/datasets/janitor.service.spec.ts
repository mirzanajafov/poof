import { Logger } from '@nestjs/common'
import type { Task } from '@poof/db'
import { Database, parseEnv } from '@poof/nest'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { Env } from '../config/env.js'
import { Datasets } from './datasets.service.js'
import { Janitor } from './janitor.service.js'

const first = '6f1c2a54-8d3e-4b7a-9c10-2e5f8a9b0c1d'
const second = '0b4e7d21-3c5a-4f6e-8a9b-1c2d3e4f5a6b'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function janitor(folders: string[]) {
  const env = parseEnv(Env, {
    DATABASE_URL: 'postgresql://localhost:1/none',
    REDIS_URL: 'redis://localhost:1',
    DATA_DIR: '/data',
    OUTPUT_TTL_HOURS: '1',
  })
  const db = new Database(env.DATABASE_URL)
  onTestFinished(() => db.onApplicationShutdown())
  const datasets = new Datasets(env)
  vi.spyOn(datasets, 'taskFolders').mockResolvedValue(folders)
  const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  return { janitor: new Janitor(env, db, datasets), db, datasets, errors }
}

const finishedLongAgo = (id: string): Task => ({
  id,
  dataset: 'small',
  offset: 0,
  preset: 'webp-1600',
  items: 1,
  policy: 'pool',
  exhibitId: null,
  status: 'DONE',
  predictedMs: 100,
  done: 1,
  deadLettered: 0,
  submittedAt: new Date(0),
  deadline: new Date(0),
  startedAt: new Date(0),
  finishedAt: new Date(0),
  traceId: null,
})

describe('Janitor', () => {
  it('logs a sweep that fails and keeps sweeping', async () => {
    vi.useFakeTimers()
    const { janitor: sweeper, db, errors } = janitor([first])
    const findMany = vi
      .spyOn(db.client.task, 'findMany')
      .mockRejectedValueOnce(new Error('Postgres went away'))
      .mockResolvedValue([])
    sweeper.onApplicationBootstrap()
    await vi.advanceTimersByTimeAsync(25 * 60_000)
    sweeper.onApplicationShutdown()
    expect(findMany).toHaveBeenCalledTimes(2)
    expect(errors).toHaveBeenCalledTimes(1)
  })

  it('removes the outputs it can and logs the ones it cannot', async () => {
    const { janitor: sweeper, db, datasets, errors } = janitor([first, second])
    vi.spyOn(db.client.task, 'findMany').mockResolvedValue([finishedLongAgo(first), finishedLongAgo(second)])
    const remove = vi
      .spyOn(datasets, 'removeTask')
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValue(undefined)
    expect(await sweeper.sweep()).toBe(1)
    expect(remove).toHaveBeenCalledWith(second)
    expect(errors).toHaveBeenCalledTimes(1)
  })
})
