import { rm } from 'node:fs/promises'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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

const http = () => request(running!.app.getHttpServer())

async function ended(id: string) {
  return until(async () => {
    const exhibit = await running!.db.exhibit.findUnique({ where: { id } })
    return exhibit && exhibit.status !== 'RUNNING' ? exhibit : null
  })
}

describe('exhibits', () => {
  it('runs forecast+preempt inside the budget and hands the cage back to the pool', async () => {
    running = await start(dataDir, { BUDGET: '2' })
    const res = await http()
      .post('/exhibits')
      .send({ policy: 'forecast+preempt', durationSeconds: 15, dataset: 'noisy', utilization: 0.8, minItems: 15, maxItems: 30, slackMin: 0.9, slackMax: 2 })
    expect(res.status).toBe(201)
    expect((await http().get('/health')).body.paused).toBe(true)
    const blocked = await http().post('/tasks').send({ dataset: 'small', preset: 'webp-1600', deadlineSeconds: 600, count: 10 })
    expect(blocked.status).toBe(503)
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    const exhibit = await ended(res.body.id)
    expect(exhibit.status).toBe('DONE')
    const stats = exhibit.stats as { peakProcesses: number; submitted: number; done: number; spawns: number }
    expect(stats.submitted).toBeGreaterThan(0)
    expect(stats.done).toBeGreaterThan(0)
    expect(stats.peakProcesses).toBeLessThanOrEqual(2)
    const tasks = await running.db.task.count({ where: { exhibitId: exhibit.id } })
    expect(tasks).toBe(stats.submitted)
    const health = await until(async () => {
      const body = (await http().get('/health')).body
      return !body.paused && body.workers === 2 ? body : null
    })
    expect(health.paused).toBe(false)
    const after = await http().post('/tasks').send({ dataset: 'small', preset: 'webp-1600', deadlineSeconds: 600, count: 10 })
    expect(after.status).toBe(201)
    await until(async () => (await running!.db.task.findUnique({ where: { id: after.body.id } }))?.status === 'DONE')
  })

  it('lets the box grow past the budget and cancels what is left when the exhibit ends', async () => {
    running = await start(dataDir, { BUDGET: '2', EXHIBIT_MAX_PROCESSES: '8' })
    const res = await http()
      .post('/exhibits')
      .send({ policy: 'box', durationSeconds: 15, dataset: 'noisy', utilization: 1.5, minItems: 20, maxItems: 40, slackMin: 0.2, slackMax: 0.5 })
    expect(res.status).toBe(201)
    const exhibit = await ended(res.body.id)
    const stats = exhibit.stats as { peakProcesses: number; splits: number; maxDepth: number; spawns: number }
    expect(stats.peakProcesses).toBeGreaterThan(2)
    expect(stats.peakProcesses).toBeLessThanOrEqual(8)
    expect(stats.splits).toBeGreaterThan(0)
    expect(stats.maxDepth).toBeGreaterThanOrEqual(1)
    const deep = await running.db.lease.count({ where: { task: { exhibitId: exhibit.id }, depth: { gt: 0 } } })
    expect(deep).toBeGreaterThan(0)
    const open = await running.db.task.count({ where: { exhibitId: exhibit.id, status: { in: ['QUEUED', 'RUNNING'] } } })
    expect(open).toBe(0)
  })

  it('runs the same kind of load through the pool without pausing it', async () => {
    running = await start(dataDir, { BUDGET: '2' })
    const res = await http()
      .post('/exhibits')
      .send({ policy: 'pool', durationSeconds: 12, dataset: 'noisy', utilization: 0.8, minItems: 15, maxItems: 30, slackMin: 0.9, slackMax: 2 })
    expect(res.status).toBe(201)
    expect((await http().get('/health')).body.paused).toBe(false)
    const exhibit = await ended(res.body.id)
    const stats = exhibit.stats as { submitted: number; done: number; peakProcesses: number }
    expect(stats.submitted).toBeGreaterThan(0)
    expect(stats.peakProcesses).toBe(2)
    const tasks = await running.db.task.findMany({ where: { exhibitId: exhibit.id } })
    expect(tasks).toHaveLength(stats.submitted)
    expect(tasks.every((t) => t.policy === 'pool')).toBe(true)
    expect(tasks.filter((t) => t.status === 'QUEUED' || t.status === 'RUNNING')).toHaveLength(0)
    expect(tasks.filter((t) => t.status === 'DONE')).toHaveLength(stats.done)
  })

  it('aborts a running exhibit', async () => {
    running = await start(dataDir)
    const res = await http().post('/exhibits').send({ policy: 'forecast+budget', durationSeconds: 300, dataset: 'small' })
    expect(res.status).toBe(201)
    expect((await http().post('/exhibits').send({ policy: 'box', durationSeconds: 30 })).status).toBe(409)
    expect((await http().get('/exhibits/current')).status).toBe(200)
    expect((await http().delete('/exhibits/current')).status).toBe(200)
    const exhibit = await running.db.exhibit.findUniqueOrThrow({ where: { id: res.body.id } })
    expect(exhibit.status).toBe('ABORTED')
    expect((await http().get('/exhibits/current')).status).toBe(404)
  })
})
