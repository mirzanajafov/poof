import { Logger } from '@nestjs/common'
import { Database, parseEnv } from '@poof/nest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Env } from '../config/env.js'
import { Datasets } from './datasets.service.js'
import { Janitor } from './janitor.service.js'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Janitor', () => {
  it('logs a sweep that fails and keeps sweeping', async () => {
    vi.useFakeTimers()
    const env = parseEnv(Env, {
      DATABASE_URL: 'postgresql://localhost:1/none',
      REDIS_URL: 'redis://localhost:1',
      DATA_DIR: '/data',
      OUTPUT_TTL_HOURS: '1',
    })
    const db = new Database(env.DATABASE_URL)
    const datasets = new Datasets(env)
    vi.spyOn(datasets, 'taskFolders').mockResolvedValue(['6f1c2a54-8d3e-4b7a-9c10-2e5f8a9b0c1d'])
    const findMany = vi
      .spyOn(db.client.task, 'findMany')
      .mockRejectedValueOnce(new Error('Postgres went away'))
      .mockResolvedValue([])
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const janitor = new Janitor(env, db, datasets)
    janitor.onApplicationBootstrap()
    await vi.advanceTimersByTimeAsync(25 * 60_000)
    janitor.onApplicationShutdown()
    expect(findMany).toHaveBeenCalledTimes(2)
    expect(logged).toHaveBeenCalledTimes(1)
  })
})
