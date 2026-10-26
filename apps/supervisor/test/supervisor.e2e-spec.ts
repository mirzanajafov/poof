import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PoolSnapshot } from '@poof/contracts'
import { createPrisma } from '@poof/db'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, onTestFinished, vi } from 'vitest'
import { http, makeData, patience, start, taskId, waitForTask, type Running } from './harness.js'

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

async function submit(running: Running, body: Record<string, unknown>) {
  return http(running).post('/tasks').send(body)
}

async function finished(running: Running, id: string) {
  return waitForTask(running, id, (task) => task.status === 'DONE' || task.status === 'FAILED')
}

async function busyWorker(running: Running) {
  return vi.waitUntil(async () => {
    const state = (await http(running).get('/state')).body as PoolSnapshot
    return state.workers.find((w) => w.lease)
  }, patience)
}

async function outputs(id: string): Promise<string[]> {
  return (await readdir(join(dataDir, 'tasks', id, 'out'))).filter((f) => f.endsWith('.webp'))
}

describe('supervisor', () => {
  it('finishes a task, writes every output and records the leases', async () => {
    running = await start(dataDir)
    const res = await submit(running, { dataset: 'small', preset: 'webp-1600', deadlineSeconds: 600, count: 30 })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ accepted: true })
    const task = await finished(running, taskId(res.body))
    expect(task.status).toBe('DONE')
    expect(task.done).toBe(30)
    expect(await outputs(task.id)).toHaveLength(30)
    const leases = await running.db.lease.findMany({ where: { taskId: task.id } })
    expect(leases).toHaveLength(3)
    expect(leases.every((l) => l.state === 'DONE' && l.cursor === l.hi)).toBe(true)
  })

  it('validates submissions', async () => {
    running = await start(dataDir)
    expect((await submit(running, { dataset: 'small', preset: 'nope', deadlineSeconds: 60 })).status).toBe(400)
    expect((await submit(running, { dataset: 'missing', preset: 'webp-1600', deadlineSeconds: 60 })).status).toBe(404)
    expect(
      (await submit(running, { dataset: 'small', preset: 'webp-1600', deadlineSeconds: 60, extra: 1 })).status,
    ).toBe(400)
  })

  it('rejects a task that cannot make its deadline, with a Retry-After', async () => {
    running = await start(dataDir)
    const res = await submit(running, { dataset: 'small', preset: 'webp-1600', deadlineSeconds: 1, count: 2000 })
    expect(res.status).toBe(429)
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    const task = await running.db.task.findUnique({ where: { id: taskId(res.body) } })
    expect(task?.status).toBe('REJECTED')
  })

  it('dead-letters a corrupt input and still finishes the task', async () => {
    running = await start(dataDir)
    const res = await submit(running, { dataset: 'mostly-good', preset: 'webp-1600', deadlineSeconds: 600 })
    const task = await finished(running, taskId(res.body))
    expect(task.status).toBe('DONE')
    expect(task.done).toBe(39)
    expect(task.deadLettered).toBe(1)
    const dead = await running.db.deadLetter.findMany({ where: { taskId: task.id } })
    expect(dead).toMatchObject([{ item: 17, attempts: 3 }])
  })

  it('fails a task once its dead letters pass the allowed share', async () => {
    running = await start(dataDir)
    const res = await submit(running, { dataset: 'broken', preset: 'webp-1600', deadlineSeconds: 600 })
    const task = await finished(running, taskId(res.body))
    expect(task.status).toBe('FAILED')
    const decision = await running.db.decision.findFirst({ where: { taskId: task.id, kind: 'fail' } })
    expect(decision).not.toBeNull()
  })

  it('replaces a worker that dies and retries the item it held', async () => {
    running = await start(dataDir, { BUDGET: '1' })
    const res = await submit(running, { dataset: 'small', preset: 'webp-1600', deadlineSeconds: 600, count: 40 })
    const busy = await busyWorker(running)
    process.kill(busy.pid, 'SIGKILL')
    const task = await finished(running, taskId(res.body))
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
    const relaxed = await submit(running, { dataset: 'small', preset: 'webp-1600', deadlineSeconds: 3600, count: 30 })
    const urgent = await submit(running, {
      dataset: 'small',
      preset: 'webp-1600',
      deadlineSeconds: 300,
      count: 20,
      offset: 10,
    })
    const a = await finished(running, taskId(relaxed.body))
    const b = await finished(running, taskId(urgent.body))
    if (!a.finishedAt || !b.finishedAt) throw new Error('a finished task has no finish time')
    expect(b.finishedAt.getTime()).toBeLessThan(a.finishedAt.getTime())
  })

  it('fails the tasks it cannot resume after a restart and says why', async () => {
    const db = createPrisma(inject('databaseUrl'))
    const unfinished = (dataset: string, preset: string) =>
      db.task.create({
        data: {
          dataset,
          preset,
          items: 10,
          policy: 'pool',
          predictedMs: 1000,
          deadline: new Date(Date.now() + 600_000),
          leases: { create: [{ lo: 0, hi: 10, cursor: 0 }] },
        },
      })
    onTestFinished(() => rm(join(dataDir, 'datasets', 'garbled'), { recursive: true, force: true }))
    await mkdir(join(dataDir, 'datasets', 'garbled'), { recursive: true })
    await writeFile(join(dataDir, 'datasets', 'garbled', 'manifest.json'), 'not json')
    const unknownPreset = await unfinished('small', 'png-9000')
    const missingDataset = await unfinished('gone', 'webp-1600')
    const unreadableDataset = await unfinished('garbled', 'webp-1600')
    await db.$disconnect()
    running = await start(dataDir)
    for (const [task, reason] of [
      [unknownPreset, 'no preset png-9000 after a restart'],
      [missingDataset, 'dataset gone after a restart'],
      [unreadableDataset, 'dataset garbled unreadable after a restart'],
    ] as const) {
      const failed = await running.db.task.findUniqueOrThrow({
        where: { id: task.id },
        include: { leases: true, decisions: true },
      })
      expect(failed.status).toBe('FAILED')
      expect(failed.leases.every((l) => l.state === 'DONE')).toBe(true)
      expect(failed.decisions.map((d) => d.detail)).toEqual([{ reason, dead: 0 }])
    }
  })

  it('resumes unfinished work after a restart without losing an item', async () => {
    running = await start(dataDir)
    const res = await submit(running, { dataset: 'small', preset: 'webp-1600', deadlineSeconds: 3600, count: 120 })
    const id = taskId(res.body)
    await waitForTask(running, id, (task) => task.done >= 20)
    await running.close()
    running = null
    const db = createPrisma(inject('databaseUrl'))
    const halfway = await db.task.findUniqueOrThrow({ where: { id } })
    await db.$disconnect()
    expect(halfway.status).toBe('RUNNING')
    expect(halfway.done).toBeLessThan(120)
    running = await start(dataDir)
    const task = await finished(running, id)
    expect(task.status).toBe('DONE')
    expect(task.done).toBe(120)
    expect(await outputs(id)).toHaveLength(120)
  })
})
