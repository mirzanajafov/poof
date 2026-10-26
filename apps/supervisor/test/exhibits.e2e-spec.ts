import { rm } from 'node:fs/promises'
import { exhibitSnapshotKey } from '@poof/contracts'
import { policies } from '@poof/core'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Scheduler } from '../src/scheduler/scheduler.service.js'
import { exhibitId, makeData, start, taskId, waitFor, waitForExhibitEnd, waitForTask, type Running } from './harness.js'

type Health = ReturnType<Scheduler['health']>

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

const http = (running: Running) => request(running.app.getHttpServer())

const onTheLiveView = async (running: Running) => (await running.redis.exists(exhibitSnapshotKey)) === 1

async function waitUntilOnTheLiveView(running: Running) {
  await waitFor(() => onTheLiveView(running), 2000)
}

async function waitUntilOffTheLiveView(running: Running) {
  await waitFor(async () => !(await onTheLiveView(running)), 2000)
  await new Promise((resolve) => setTimeout(resolve, 1500))
  expect(await onTheLiveView(running)).toBe(false)
}

async function waitUntilThePoolResumes(running: Running, workers: number) {
  return waitFor(async () => {
    const health = (await http(running).get('/health')).body as Health
    return !health.paused && health.workers === workers ? health : null
  })
}

describe('exhibits', () => {
  it('runs forecast+preempt inside the budget and hands the cage back to the pool', async () => {
    running = await start(dataDir, { BUDGET: '2' })
    const res = await http(running).post('/exhibits').send({
      policy: 'forecast+preempt',
      durationSeconds: 15,
      dataset: 'noisy',
      utilization: 0.8,
      minItems: 15,
      maxItems: 30,
      slackMin: 0.9,
      slackMax: 2,
    })
    expect(res.status).toBe(201)
    expect((await http(running).get('/health')).body).toMatchObject({ paused: true })
    expect((await http(running).get('/state')).body).toMatchObject({ paused: true })
    const blocked = await http(running)
      .post('/tasks')
      .send({ dataset: 'small', preset: 'webp-1600', deadlineSeconds: 600, count: 10 })
    expect(blocked.status).toBe(503)
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    await waitUntilOnTheLiveView(running)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect((await http(running).get('/health')).body).toMatchObject({ workers: 0 })
    const exhibit = await waitForExhibitEnd(running, exhibitId(res.body))
    expect(exhibit.status).toBe('DONE')
    await waitUntilOffTheLiveView(running)
    const stats = exhibit.stats as { peakProcesses: number; submitted: number; done: number; spawns: number }
    expect(stats.submitted).toBeGreaterThan(0)
    expect(stats.done).toBeGreaterThan(0)
    expect(stats.peakProcesses).toBeLessThanOrEqual(2)
    const tasks = await running.db.task.count({ where: { exhibitId: exhibit.id } })
    expect(tasks).toBe(stats.submitted)
    const health = await waitUntilThePoolResumes(running, 2)
    expect(health.paused).toBe(false)
    const after = await http(running)
      .post('/tasks')
      .send({ dataset: 'small', preset: 'webp-1600', deadlineSeconds: 600, count: 10 })
    expect(after.status).toBe(201)
    await waitForTask(running, taskId(after.body), (task) => task.status === 'DONE')
  })

  it('lets the box grow past the budget and cancels what is left when the exhibit ends', async () => {
    running = await start(dataDir, { BUDGET: '2', EXHIBIT_MAX_PROCESSES: '8' })
    const res = await http(running).post('/exhibits').send({
      policy: 'box',
      durationSeconds: 15,
      dataset: 'noisy',
      utilization: 1.5,
      minItems: 20,
      maxItems: 40,
      slackMin: 0.2,
      slackMax: 0.5,
    })
    expect(res.status).toBe(201)
    const exhibit = await waitForExhibitEnd(running, exhibitId(res.body))
    const stats = exhibit.stats as { peakProcesses: number; splits: number; maxDepth: number; spawns: number }
    expect(stats.peakProcesses).toBeGreaterThan(2)
    expect(stats.peakProcesses).toBeLessThanOrEqual(8)
    expect(stats.splits).toBeGreaterThan(0)
    expect(stats.maxDepth).toBeGreaterThanOrEqual(1)
    const deep = await running.db.lease.count({ where: { task: { exhibitId: exhibit.id }, depth: { gt: 0 } } })
    expect(deep).toBeGreaterThan(0)
    const open = await running.db.task.count({
      where: { exhibitId: exhibit.id, status: { in: ['QUEUED', 'RUNNING'] } },
    })
    expect(open).toBe(0)
  })

  it('lets a helper split only after ten images of its own', async () => {
    running = await start(dataDir, { BUDGET: '2', EXHIBIT_MAX_PROCESSES: '8' })
    const res = await http(running).post('/exhibits').send({
      policy: 'box',
      durationSeconds: 20,
      dataset: 'noisy',
      utilization: 0.4,
      minItems: 150,
      maxItems: 200,
      slackMin: 0.1,
      slackMax: 0.15,
    })
    expect(res.status).toBe(201)
    const exhibit = await waitForExhibitEnd(running, exhibitId(res.body))
    const leases = await running.db.lease.findMany({ where: { task: { exhibitId: exhibit.id } } })
    const depth = new Map(leases.map((l) => [l.id, l.depth]))
    const splits = await running.db.decision.findMany({ where: { kind: 'split', task: { exhibitId: exhibit.id } } })
    const details = splits.map((s) => s.detail as { lease: string; workerItems: number })
    expect(details.some((d) => (depth.get(d.lease) ?? 0) > 0)).toBe(true)
    for (const d of details) expect(d.workerItems).toBeGreaterThanOrEqual(policies.box.warmupItems)
  })

  it('runs the same kind of load through the pool without pausing it', async () => {
    running = await start(dataDir, { BUDGET: '2' })
    const res = await http(running).post('/exhibits').send({
      policy: 'pool',
      durationSeconds: 12,
      dataset: 'noisy',
      utilization: 0.8,
      minItems: 15,
      maxItems: 30,
      slackMin: 0.9,
      slackMax: 2,
    })
    expect(res.status).toBe(201)
    expect((await http(running).get('/health')).body).toMatchObject({ paused: false })
    expect((await http(running).get('/state')).body).toMatchObject({ paused: false })
    const exhibit = await waitForExhibitEnd(running, exhibitId(res.body))
    await waitUntilOffTheLiveView(running)
    const stats = exhibit.stats as { submitted: number; done: number; peakProcesses: number }
    expect(stats.submitted).toBeGreaterThan(0)
    expect(stats.peakProcesses).toBe(2)
    const tasks = await running.db.task.findMany({ where: { exhibitId: exhibit.id } })
    expect(tasks).toHaveLength(stats.submitted)
    expect(tasks.every((t) => t.policy === 'pool')).toBe(true)
    expect(tasks.filter((t) => t.status === 'QUEUED' || t.status === 'RUNNING')).toHaveLength(0)
    expect(tasks.filter((t) => t.status === 'DONE')).toHaveLength(stats.done)
  })

  it('refuses a null where an exhibit setting has a default', async () => {
    running = await start(dataDir)
    const before = await running.db.exhibit.count()
    const fields = [
      'durationSeconds',
      'utilization',
      'dataset',
      'preset',
      'minItems',
      'maxItems',
      'slackMin',
      'slackMax',
      'seed',
    ]
    for (const field of fields) {
      expect(
        (
          await http(running)
            .post('/exhibits')
            .send({ policy: 'box', [field]: null })
        ).status,
      ).toBe(400)
    }
    expect(await running.db.exhibit.count()).toBe(before)
  })

  it('refuses an exhibit whose largest task or loosest deadline is below its smallest', async () => {
    running = await start(dataDir)
    const before = await running.db.exhibit.count()
    const items = await http(running).post('/exhibits').send({ policy: 'box', minItems: 50, maxItems: 30 })
    expect(items.status).toBe(400)
    expect(items.body).toHaveProperty('message', ['maxItems must not be below minItems'])
    const floor = await http(running).post('/exhibits').send({ policy: 'box', minItems: 'many' })
    expect(floor.status).toBe(400)
    expect(floor.body).toHaveProperty('message', expect.not.arrayContaining(['maxItems must not be below minItems']))
    const ceiling = await http(running).post('/exhibits').send({ policy: 'box', maxItems: 'many' })
    expect(ceiling.status).toBe(400)
    expect(ceiling.body).toHaveProperty('message', expect.not.arrayContaining(['maxItems must not be below minItems']))
    const slack = await http(running).post('/exhibits').send({ policy: 'box', slackMin: 2, slackMax: 1 })
    expect(slack.status).toBe(400)
    expect(slack.body).toHaveProperty('message', ['slackMax must not be below slackMin'])
    expect(await running.db.exhibit.count()).toBe(before)
  })

  it('refuses an exhibit policy or preset it does not know', async () => {
    running = await start(dataDir)
    const before = await running.db.exhibit.count()
    const policy = await http(running).post('/exhibits').send({ policy: 'nope', durationSeconds: 30 })
    expect(policy.status).toBe(400)
    expect(policy.body).toHaveProperty('message', [expect.stringMatching(/^policy must be one of/)])
    const preset = await http(running)
      .post('/exhibits')
      .send({ policy: 'box', durationSeconds: 30, preset: 'png-9000' })
    expect(preset.status).toBe(400)
    expect(preset.body).toHaveProperty('message', [expect.stringMatching(/^preset must be one of/)])
    expect(await running.db.exhibit.count()).toBe(before)
  })

  it('starts only one of two exhibits sent at the same moment', async () => {
    running = await start(dataDir)
    const before = await running.db.exhibit.count()
    const body = { policy: 'forecast+budget', durationSeconds: 300, dataset: 'small' }
    const api = http(running)
    const statuses = await Promise.all([1, 2].map(async () => (await api.post('/exhibits').send(body)).status))
    expect(statuses.sort()).toEqual([201, 409])
    expect(await running.db.exhibit.count()).toBe(before + 1)
  })

  it('keeps the pool paused for an exhibit that starts while the last one is stopping', async () => {
    running = await start(dataDir)
    const body = { policy: 'forecast+budget', durationSeconds: 300, dataset: 'small' }
    expect((await http(running).post('/exhibits').send(body)).status).toBe(201)
    const [, next] = await Promise.all([
      http(running).delete('/exhibits/current'),
      http(running).post('/exhibits').send(body),
    ])
    const { paused } = (await http(running).get('/health')).body as Health
    expect(next.status === 409 || paused).toBe(true)
  })

  it('aborts a running exhibit and takes it off the live view at once', async () => {
    running = await start(dataDir)
    const res = await http(running)
      .post('/exhibits')
      .send({ policy: 'forecast+budget', durationSeconds: 300, dataset: 'small' })
    expect(res.status).toBe(201)
    expect((await http(running).post('/exhibits').send({ policy: 'box', durationSeconds: 30 })).status).toBe(409)
    expect((await http(running).get('/exhibits/current')).status).toBe(200)
    await waitUntilOnTheLiveView(running)
    expect((await http(running).delete('/exhibits/current')).status).toBe(200)
    const exhibit = await running.db.exhibit.findUniqueOrThrow({ where: { id: exhibitId(res.body) } })
    expect(exhibit.status).toBe('ABORTED')
    expect((await http(running).get('/exhibits/current')).status).toBe(404)
    await waitUntilOffTheLiveView(running)
  })
})
