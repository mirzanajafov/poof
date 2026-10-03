import { existsSync } from 'node:fs'
import { mkdir, rm, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Janitor } from '../src/datasets/janitor.service.js'
import { makeData, start, until, type Running } from './harness.js'

let dataDir: string
let running: Running | null = null

beforeAll(async () => {
  dataDir = await makeData()
})

afterEach(async () => {
  await running?.close()
  running = null
})

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

describe('janitor', () => {
  it('removes outputs past their TTL and leaves running, recent and half-created tasks alone', async () => {
    running = await start(dataDir, { OUTPUT_TTL_HOURS: '1' })
    const janitor = running.app.get(Janitor)
    const res = await request(running.app.getHttpServer())
      .post('/tasks')
      .send({ dataset: 'small', preset: 'webp-1600', deadlineSeconds: 600, count: 10 })
    const done = res.body.id as string
    await until(async () => (await running!.db.task.findUnique({ where: { id: done } }))?.status === 'DONE')
    const fresh = join(dataDir, 'tasks', randomUUID())
    const stale = join(dataDir, 'tasks', randomUUID())
    await mkdir(fresh, { recursive: true })
    await mkdir(stale, { recursive: true })
    const old = new Date(Date.now() - 2 * 3_600_000)
    await utimes(stale, old, old)

    expect(await janitor.sweep()).toBe(1)
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(join(dataDir, 'tasks', done))).toBe(true)

    expect(await janitor.sweep(Date.now() + 2 * 3_600_000)).toBeGreaterThanOrEqual(2)
    expect(existsSync(join(dataDir, 'tasks', done))).toBe(false)
    expect((await running.db.task.findUnique({ where: { id: done } }))?.status).toBe('DONE')
  })
})
