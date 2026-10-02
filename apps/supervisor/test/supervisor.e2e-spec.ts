import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createPrisma } from '@poof/db'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
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

async function submit(body: Record<string, unknown>) {
  return request(running!.app.getHttpServer()).post('/tasks').send(body)
}

async function finished(id: string) {
  return until(async () => {
    const task = await running!.db.task.findUnique({ where: { id } })
    return task && (task.status === 'DONE' || task.status === 'FAILED') ? task : null
  })
}

async function outputs(id: string): Promise<string[]> {
  return (await readdir(join(dataDir, 'tasks', id, 'out'))).filter((f) => f.endsWith('.webp'))
}

describe('supervisor', () => {
  it('finishes a task, writes every output and records the leases', async () => {
    running = await start(dataDir)
    const res = await submit({ dataset: 'small', preset: 'webp-1600', deadlineSeconds: 600, count: 30 })
    expect(res.status).toBe(201)
    expect(res.body.accepted).toBe(true)
    const task = await finished(res.body.id)
    expect(task.status).toBe('DONE')
    expect(task.done).toBe(30)
    expect(await outputs(task.id)).toHaveLength(30)
    const leases = await running.db.lease.findMany({ where: { taskId: task.id } })
    expect(leases).toHaveLength(3)
    expect(leases.every((l) => l.state === 'DONE' && l.cursor === l.hi)).toBe(true)
  })

  it('validates submissions', async () => {
    running = await start(dataDir)
    expect((await submit({ dataset: 'small', preset: 'nope', deadlineSeconds: 60 })).status).toBe(400)
    expect((await submit({ dataset: 'missing', preset: 'webp-1600', deadlineSeconds: 60 })).status).toBe(404)
    expect((await submit({ dataset: 'small', preset: 'webp-1600', deadlineSeconds: 60, extra: 1 })).status).toBe(400)
  })

  it('rejects a task that cannot make its deadline, with a Retry-After', async () => {
    running = await start(dataDir)
    const res = await submit({ dataset: 'small', preset: 'webp-1600', deadlineSeconds: 1, count: 2000 })
    expect(res.status).toBe(429)
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    const task = await running.db.task.findUnique({ where: { id: res.body.id } })
    expect(task?.status).toBe('REJECTED')
  })

  it('dead-letters a corrupt input and still finishes the task', async () => {
    running = await start(dataDir)
    const res = await submit({ dataset: 'mostly-good', preset: 'webp-1600', deadlineSeconds: 600 })
    const task = await finished(res.body.id)
    expect(task.status).toBe('DONE')
    expect(task.done).toBe(39)
    expect(task.deadLettered).toBe(1)
    const dead = await running.db.deadLetter.findMany({ where: { taskId: task.id } })
    expect(dead.map((d) => d.item)).toEqual([17])
    expect(dead[0]!.attempts).toBe(3)
  })

  it('fails a task once its dead letters pass the allowed share', async () => {
    running = await start(dataDir)
    const res = await submit({ dataset: 'broken', preset: 'webp-1600', deadlineSeconds: 600 })
    const task = await finished(res.body.id)
    expect(task.status).toBe('FAILED')
    const decision = await running.db.decision.findFirst({ where: { taskId: task.id, kind: 'fail' } })
    expect(decision).not.toBeNull()
  })

  it('replaces a worker that dies and retries the item it held', async () => {
    running = await start(dataDir, { BUDGET: '1' })
    const res = await submit({ dataset: 'small', preset: 'webp-1600', deadlineSeconds: 600, count: 40 })
    const busy = await until(async () => {
      const state = (await request(running!.app.getHttpServer()).get('/state')).body
      return state.workers.find((w: { lease: unknown; pid: number }) => w.lease)
    })
    process.kill(busy.pid, 'SIGKILL')
    const task = await finished(res.body.id)
    expect(task.status).toBe('DONE')
    expect(task.done).toBe(40)
    expect(await outputs(task.id)).toHaveLength(40)
    const crashed = await running.db.worker.findMany({ where: { exit: 'CRASH' } })
    expect(crashed.length).toBeGreaterThanOrEqual(1)
    const decision = await running.db.decision.findFirst({ where: { taskId: task.id, kind: 'worker-exit' } })
    expect(decision).not.toBeNull()
  })

  it('serves the earliest deadline first', async () => {
    running = await start(dataDir, { BUDGET: '1' })
    const relaxed = await submit({ dataset: 'small', preset: 'webp-1600', deadlineSeconds: 3600, count: 30 })
    const urgent = await submit({ dataset: 'small', preset: 'webp-1600', deadlineSeconds: 300, count: 20, offset: 10 })
    const a = await finished(relaxed.body.id)
    const b = await finished(urgent.body.id)
    expect(b.finishedAt!.getTime()).toBeLessThan(a.finishedAt!.getTime())
  })

  it('resumes unfinished work after a restart without losing an item', async () => {
    running = await start(dataDir)
    const res = await submit({ dataset: 'small', preset: 'webp-1600', deadlineSeconds: 3600, count: 120 })
    const id = res.body.id as string
    await until(async () => {
      const task = await running!.db.task.findUnique({ where: { id } })
      return task && task.done >= 20
    })
    await running.close()
    running = null
    const db = createPrisma(inject('databaseUrl'))
    const halfway = await db.task.findUniqueOrThrow({ where: { id } })
    await db.$disconnect()
    expect(halfway.status).toBe('RUNNING')
    expect(halfway.done).toBeLessThan(120)
    running = await start(dataDir)
    const task = await finished(id)
    expect(task.status).toBe('DONE')
    expect(task.done).toBe(120)
    expect(await outputs(id)).toHaveLength(120)
  })
})
