import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  exhibitDefaults,
  liveEventsChannel,
  poolSnapshotKey,
  type LiveBatch,
  type LiveEvent,
  type LiveSnapshot,
  type LiveSocketEvents,
  type PoolSnapshot,
} from '@poof/contracts'
import { io, type Socket } from 'socket.io-client'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { adminToken, start, StubSupervisor, type Running } from './harness.js'

const supervisor = new StubSupervisor()
let running: Running | null = null

beforeAll(async () => {
  await supervisor.start()
})

afterAll(async () => {
  await supervisor.stop()
})

afterEach(async () => {
  vi.useRealTimers()
  if (running) {
    await running.close()
    await rm(running.dataDir, { recursive: true, force: true })
  }
  running = null
  supervisor.calls.length = 0
  supervisor.reply = () => ({ status: 201, body: { accepted: true, id: 'x' } })
})

const http = () => request(running!.app.getHttpServer())
const poolSnapshot = (): PoolSnapshot => ({ at: 0, budget: 2, workers: [], tasks: [], breakers: {} })
const admin = { Authorization: `Bearer ${adminToken}` }
const midWindow = new Date('2026-10-26T12:30:30Z')

async function seedTask() {
  const id = randomUUID()
  await running!.db.task.create({
    data: {
      id,
      dataset: 'synthetic',
      preset: 'webp-1600',
      items: 20,
      policy: 'pool',
      status: 'DONE',
      predictedMs: 4000,
      done: 19,
      deadLettered: 1,
      deadline: new Date(Date.now() + 60_000),
      leases: {
        create: [
          { lo: 0, hi: 10, cursor: 10, state: 'DONE' },
          { lo: 10, hi: 20, cursor: 20, state: 'DONE' },
        ],
      },
      deadLetters: { create: [{ item: 4, attempts: 3, error: 'bad input' }] },
      decisions: { create: [{ kind: 'worker-exit', detail: { reason: 'crash', item: 4 } }] },
    },
  })
  return id
}

describe('read model', () => {
  it('lists tasks and shows one with its leases, dead letters and decisions', async () => {
    running = await start(supervisor.url)
    const id = await seedTask()
    const list = await http().get('/api/tasks?limit=5')
    expect(list.status).toBe(200)
    expect(list.body.some((t: { id: string }) => t.id === id)).toBe(true)
    const detail = await http().get(`/api/tasks/${id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.leases).toHaveLength(2)
    expect(detail.body.deadLetters[0].item).toBe(4)
    expect(detail.body.decisions[0].kind).toBe('worker-exit')
    expect((await http().get(`/api/tasks/${randomUUID()}`)).status).toBe(404)
    expect((await http().get('/api/tasks/not-a-uuid')).status).toBe(400)
    expect((await http().get('/api/tasks?limit=1000')).status).toBe(400)
  })

  it('serves images from a data directory with a dot in its path', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), '.poof-api-'))
    running = await start(supervisor.url, { DATA_DIR: dataDir })
    const id = randomUUID()
    await mkdir(join(dataDir, 'tasks', id, 'out'), { recursive: true })
    await writeFile(join(dataDir, 'tasks', id, 'out', '0.webp'), Buffer.from('RIFF....WEBP'))
    expect((await http().get(`/api/tasks/${id}/items/0`)).status).toBe(200)
  })

  it('reports that Redis and Postgres answer', async () => {
    running = await start(supervisor.url)
    expect((await http().get('/api/health')).body).toEqual({ ok: true, redis: true, db: true })
  })

  it('answers 503, not 404 or 500, while Redis is down', async () => {
    running = await start(supervisor.url, { REDIS_URL: 'redis://127.0.0.1:9' })
    const health = await http().get('/api/health')
    expect(health.status).toBe(503)
    expect(health.body).toEqual({ ok: false, redis: false, db: true })
    expect((await http().get('/api/state')).status).toBe(503)
    expect((await http().get('/api/exhibits/current')).status).toBe(503)
    const body = { dataset: 'synthetic', preset: 'webp-1600', deadlineSeconds: 60 }
    expect((await http().post('/api/tasks').send(body)).status).toBe(503)
    expect(supervisor.calls).toHaveLength(0)
  })

  it('lists the datasets on disk that the supervisor would serve', async () => {
    running = await start(supervisor.url)
    const items = [
      { file: 'a.jpg', width: 4000, height: 3000 },
      { file: 'b.jpg', width: 1000, height: 1000 },
    ]
    for (const name of ['tiny', 'Not_A_Name']) {
      await mkdir(join(running.dataDir, 'datasets', name), { recursive: true })
      await writeFile(join(running.dataDir, 'datasets', name, 'manifest.json'), JSON.stringify({ items }))
    }
    const res = await http().get('/api/datasets')
    expect(res.body).toEqual([{ name: 'tiny', items: 2, meanMp: 6.5 }])
  })

  it('serves a finished image and nothing outside the task folder', async () => {
    running = await start(supervisor.url)
    const id = randomUUID()
    await mkdir(join(running.dataDir, 'tasks', id, 'out'), { recursive: true })
    await writeFile(join(running.dataDir, 'tasks', id, 'out', '3.webp'), Buffer.from('RIFF....WEBP'))
    const res = await http().get(`/api/tasks/${id}/items/3`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/webp')
    expect(res.headers['cache-control']).toBe('public, max-age=86400, immutable')
    const missing = await http().get(`/api/tasks/${id}/items/4`)
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ message: 'Not Found', statusCode: 404 })
    const changed = await http().get(`/api/tasks/${id}/items/3`).set('If-Unmodified-Since', new Date(0).toUTCString())
    expect(changed.status).toBe(412)
    expect(changed.headers['cache-control']).toBeUndefined()
    expect(changed.headers['access-control-allow-origin']).toBe('http://localhost:3112')
    await writeFile(join(running.dataDir, 'tasks', id, 'out', '5.jpg'), Buffer.from('not really a jpeg'))
    expect((await http().get(`/api/tasks/${id}/items/5`)).headers['content-type']).toBe('image/jpeg')
    expect((await http().get(`/api/tasks/${randomUUID()}/items/3`)).status).toBe(404)
    expect((await http().get(`/api/tasks/${id}/items/..%2F..%2Fsecret`)).status).toBe(400)
    expect((await http().get('/api/tasks/..%2F..%2Fetc/items/1')).status).toBe(400)
  })
})

describe('submissions', () => {
  it('forwards a task to the supervisor and relays its answer', async () => {
    running = await start(supervisor.url)
    const body = { dataset: 'synthetic', preset: 'webp-1600', deadlineSeconds: 120, count: 40 }
    const ok = await http().post('/api/tasks').send(body)
    expect(ok.status).toBe(201)
    expect(supervisor.calls[0]).toEqual({ method: 'POST', path: '/tasks', body })
    supervisor.reply = () => ({ status: 429, body: { accepted: false }, headers: { 'retry-after': '7' } })
    const busy = await http().post('/api/tasks').send(body)
    expect(busy.status).toBe(429)
    expect(busy.headers['retry-after']).toBe('7')
    expect(
      (
        await http()
          .post('/api/tasks')
          .send({ ...body, extra: true })
      ).status,
    ).toBe(400)
  })

  it('refuses a preset or task status it does not know without asking the supervisor', async () => {
    running = await start(supervisor.url)
    const submitted = await http()
      .post('/api/tasks')
      .send({ dataset: 'synthetic', preset: 'png-9000', deadlineSeconds: 60 })
    expect(submitted.status).toBe(400)
    expect(submitted.body.message).toEqual([expect.stringMatching(/^preset must be one of/)])
    expect((await http().get('/api/tasks?status=LOST')).status).toBe(400)
    expect(supervisor.calls).toHaveLength(0)
  })

  it('answers 502 when the supervisor is down', async () => {
    running = await start('http://127.0.0.1:9')
    const res = await http().post('/api/tasks').send({ dataset: 'synthetic', preset: 'webp-1600', deadlineSeconds: 60 })
    expect(res.status).toBe(502)
  })

  it('answers 502 when the supervisor sends something that is not JSON', async () => {
    running = await start(supervisor.url)
    supervisor.reply = () => ({ status: 200, raw: '<html>bad gateway</html>' })
    const res = await http().post('/api/tasks').send({ dataset: 'synthetic', preset: 'webp-1600', deadlineSeconds: 60 })
    expect(res.status).toBe(502)
  })

  it('counts each forwarded address on its own behind a trusted proxy', async () => {
    vi.setSystemTime(midWindow)
    running = await start(supervisor.url, { TRUST_PROXY: 'loopback, uniquelocal', TASKS_PER_MINUTE: '1' })
    const body = { dataset: 'synthetic', preset: 'webp-1600', deadlineSeconds: 60 }
    const from = (address: string) => http().post('/api/tasks').set('X-Forwarded-For', address).send(body)
    expect((await from('203.0.113.1')).status).toBe(201)
    expect((await from('203.0.113.1')).status).toBe(429)
    expect((await from('203.0.113.2')).status).toBe(201)
  })

  it('rate-limits submissions per address, except for the admin token', async () => {
    vi.setSystemTime(midWindow)
    running = await start(supervisor.url, { TASKS_PER_MINUTE: '3' })
    const body = { dataset: 'synthetic', preset: 'webp-1600', deadlineSeconds: 60 }
    for (let i = 0; i < 3; i++) expect((await http().post('/api/tasks').send(body)).status).toBe(201)
    const limited = await http().post('/api/tasks').send(body)
    expect(limited.status).toBe(429)
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
    expect(supervisor.calls).toHaveLength(3)
    expect((await http().post('/api/tasks').set(admin).send(body)).status).toBe(201)
  })
})

describe('exhibits', () => {
  it('limits public exhibits by length and cooldown, and gives the cooldown back when the supervisor refuses', async () => {
    running = await start(supervisor.url, { EXHIBITS_PER_HOUR: '10' })
    expect((await http().post('/api/exhibits').send({ policy: 'box', durationSeconds: 300 })).status).toBe(400)
    supervisor.reply = () => ({ status: 409, body: { message: 'an exhibit is already running' } })
    expect((await http().post('/api/exhibits').send({ policy: 'box', durationSeconds: 30 })).status).toBe(409)
    supervisor.reply = () => ({ status: 201, body: { id: 'e1', endsAt: 1 } })
    expect((await http().post('/api/exhibits').send({ policy: 'box', durationSeconds: 30 })).status).toBe(201)
    const cooling = await http().post('/api/exhibits').send({ policy: 'forecast+preempt', durationSeconds: 30 })
    expect(cooling.status).toBe(429)
    expect(cooling.body.message).toMatch(/cooling down/)
    expect(Number(cooling.headers['retry-after'])).toBeGreaterThan(100)
    expect(Number(cooling.headers['retry-after'])).toBeLessThanOrEqual(150)
    expect((await http().post('/api/exhibits').set(admin).send({ policy: 'box', durationSeconds: 300 })).status).toBe(
      201,
    )
  })

  it('keeps the cooldown when the supervisor does not answer, since the exhibit may have started', async () => {
    running = await start('http://127.0.0.1:9')
    expect((await http().post('/api/exhibits').send({ policy: 'box' })).status).toBe(502)
    const cooling = await http().post('/api/exhibits').send({ policy: 'box' })
    expect(cooling.status).toBe(429)
    expect(cooling.body.message).toMatch(/cooling down/)
  })

  it('keeps the cooldown of a visitor when the supervisor refuses an exhibit the admin started', async () => {
    running = await start(supervisor.url)
    supervisor.reply = () => ({ status: 201, body: { id: 'e1', endsAt: 1 } })
    expect((await http().post('/api/exhibits').send({ policy: 'box' })).status).toBe(201)
    supervisor.reply = () => ({ status: 409, body: { message: 'an exhibit is already running' } })
    expect((await http().post('/api/exhibits').set(admin).send({ policy: 'box' })).status).toBe(409)
    const cooling = await http().post('/api/exhibits').send({ policy: 'box' })
    expect(cooling.status).toBe(429)
    expect(cooling.body.message).toMatch(/cooling down/)
  })

  it('refuses a null where an exhibit setting has a default, without asking the supervisor', async () => {
    running = await start(supervisor.url)
    for (const field of ['policy', 'durationSeconds', 'utilization', 'dataset', 'seed']) {
      expect(
        (
          await http()
            .post('/api/exhibits')
            .set(admin)
            .send({ policy: 'box', [field]: null })
        ).status,
      ).toBe(400)
    }
    expect(supervisor.calls).toHaveLength(0)
  })

  it('fills in the public exhibit for a visitor who only picks a policy', async () => {
    running = await start(supervisor.url)
    supervisor.reply = () => ({ status: 201, body: { id: 'e1', endsAt: 1 } })
    expect((await http().post('/api/exhibits').send({ policy: 'box' })).status).toBe(201)
    expect(supervisor.calls[0]?.body).toEqual({
      policy: 'box',
      durationSeconds: exhibitDefaults.durationSeconds,
      utilization: exhibitDefaults.utilization,
      dataset: exhibitDefaults.dataset,
      seed: exhibitDefaults.seed,
    })
  })

  it('lets one address start three public exhibits an hour', async () => {
    vi.setSystemTime(midWindow)
    running = await start(supervisor.url, { EXHIBIT_COOLDOWN_SECONDS: '0' })
    supervisor.reply = () => ({ status: 201, body: { id: 'e1', endsAt: 1 } })
    for (let i = 0; i < 3; i++)
      expect((await http().post('/api/exhibits').send({ policy: 'box', durationSeconds: 30 })).status).toBe(201)
    const limited = await http().post('/api/exhibits').send({ policy: 'box', durationSeconds: 30 })
    expect(limited.status).toBe(429)
    expect(limited.body.message).toMatch(/too many requests/)
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(3600)
  })

  it('refuses an exhibit policy it does not know without asking the supervisor', async () => {
    running = await start(supervisor.url)
    const res = await http().post('/api/exhibits').send({ policy: 'nope', durationSeconds: 30 })
    expect(res.status).toBe(400)
    expect(res.body.message).toEqual([expect.stringMatching(/^policy must be one of/)])
    expect(supervisor.calls).toHaveLength(0)
  })

  it('only lets the admin abort an exhibit', async () => {
    running = await start(supervisor.url)
    supervisor.reply = () => ({ status: 200, body: { submitted: 3 } })
    expect((await http().delete('/api/exhibits/current')).status).toBe(401)
    expect((await http().delete('/api/exhibits/current').set({ Authorization: 'Bearer wrong' })).status).toBe(401)
    expect((await http().delete('/api/exhibits/current').set(admin)).status).toBe(200)
    expect(supervisor.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/exhibits/current' })
  })
})

describe('live view', () => {
  it('sends a snapshot on connect and relays supervisor events in batches', async () => {
    running = await start(supervisor.url)
    await running.redis.set(poolSnapshotKey, JSON.stringify(poolSnapshot()))
    const socket: Socket<LiveSocketEvents> = io(running.url, { transports: ['websocket'] })
    const snapshot = await new Promise<LiveSnapshot>((resolve) => socket.once('snapshot', resolve))
    expect(snapshot.live?.budget).toBe(2)
    const batch = new Promise<LiveBatch>((resolve) => socket.on('events', resolve))
    await new Promise((resolve) => setTimeout(resolve, 100))
    const item = (n: number): LiveEvent => ({ kind: 'item', at: 0, task: 't', lease: 'l', item: n, ok: true })
    await running.redis.publish(liveEventsChannel, JSON.stringify(item(1)))
    await running.redis.publish(liveEventsChannel, JSON.stringify(item(2)))
    const received = await batch
    expect(received.events.map((e) => e.kind)).toContain('item')
    socket.close()
  })

  it('answers the live snapshot over HTTP too', async () => {
    running = await start(supervisor.url)
    expect((await http().get('/api/state')).body).toEqual({ live: null, exhibit: null })
    await running.redis.set(poolSnapshotKey, JSON.stringify(poolSnapshot()))
    expect((await http().get('/api/state')).body).toEqual({ live: poolSnapshot(), exhibit: null })
  })

  it('lets only the configured web origin read the polling handshake', async () => {
    running = await start(supervisor.url, { WEB_ORIGIN: 'https://poof.example' })
    const handshake = (origin: string) => http().get('/socket.io/?EIO=4&transport=polling').set('Origin', origin)
    const allowed = await handshake('https://poof.example')
    expect(allowed.status).toBe(200)
    expect(allowed.headers['access-control-allow-origin']).toBe('https://poof.example')
    const foreign = await handshake('https://elsewhere.example')
    expect(foreign.headers['access-control-allow-origin']).toBe('https://poof.example')
  })
})
