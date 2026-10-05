import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WorkerHandle, type Limits, type WorkerExit } from '../src/handle.ts'
import type { ItemDead, ItemDone, LeaseDone } from '../src/protocol.ts'

let root: string

async function makeTask(name: string, count: number, corrupt: number[] = []): Promise<string> {
  const taskDir = join(root, name)
  await mkdir(join(taskDir, 'input'), { recursive: true })
  const items = []
  for (let i = 0; i < count; i++) {
    const file = `${i}.jpg`
    const body = corrupt.includes(i)
      ? Buffer.from('this is not a jpeg')
      : await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: i * 7, g: 90, b: 160 } } })
          .jpeg()
          .toBuffer()
    await writeFile(join(taskDir, 'input', file), body)
    items.push({ file })
  }
  await writeFile(join(taskDir, 'manifest.json'), JSON.stringify({ items }))
  return taskDir
}

async function started(limits: Partial<Limits> = {}): Promise<WorkerHandle> {
  const handle = new WorkerHandle({ limits: { watchMs: 20, ...limits } })
  await handle.start()
  return handle
}

function collect(handle: WorkerHandle) {
  const items: Array<ItemDone | ItemDead> = []
  const leases: LeaseDone[] = []
  handle.on('item', (item) => items.push(item))
  handle.on('leaseDone', (lease) => leases.push(lease))
  const exited = new Promise<WorkerExit>((resolve) => handle.once('exit', resolve))
  const leaseDone = (lease: string) =>
    new Promise<LeaseDone>((resolve) => {
      const found = leases.find((l) => l.lease === lease)
      if (found) return resolve(found)
      handle.on('leaseDone', (l) => l.lease === lease && resolve(l))
    })
  return { items, leases, exited, leaseDone }
}

const assignment = (taskDir: string, lease: string, lo: number, hi: number) => ({
  lease,
  task: 't',
  taskDir,
  preset: 'webp-1600' as const,
  lo,
  hi,
  maxAttempts: 3,
})

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'poof-worker-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('worker', () => {
  it('processes a range, writes every output and reports each item', async () => {
    const taskDir = await makeTask('range', 6)
    const handle = await started()
    const { items, leaseDone, exited } = collect(handle)
    handle.assign(assignment(taskDir, 'a', 1, 5), 10_000)
    const done = await leaseDone('a')
    expect(done.hi).toBe(5)
    expect(items.map((i) => i.item)).toEqual([1, 2, 3, 4])
    expect(items.every((i) => i.ok)).toBe(true)
    for (const i of items as ItemDone[]) expect(i.stepCpuMs).toBeGreaterThanOrEqual(i.cpuMs)
    for (const i of [1, 2, 3, 4]) expect(existsSync(join(taskDir, 'out', `${i}.webp`))).toBe(true)
    expect(existsSync(join(taskDir, 'out', '0.webp'))).toBe(false)
    handle.stop()
    expect((await exited).reason).toBe('normal')
  })

  it('accepts a shrink past the item in flight and stops at the cut', async () => {
    const taskDir = await makeTask('shrink', 40)
    const handle = await started()
    const { items, leaseDone } = collect(handle)
    handle.assign(assignment(taskDir, 'a', 0, 40), 10_000)
    const shrunk = await handle.shrink('a', 10)
    expect(shrunk.ok).toBe(true)
    const done = await leaseDone('a')
    expect(done.hi).toBe(10)
    expect(items.map((i) => i.item)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(existsSync(join(taskDir, 'out', '10.webp'))).toBe(false)
    handle.kill()
  })

  it('refuses a cut at or behind the item in flight', async () => {
    const taskDir = await makeTask('refuse', 20)
    const handle = await started()
    const { leaseDone } = collect(handle)
    handle.assign(assignment(taskDir, 'a', 5, 20), 10_000)
    const shrunk = await handle.shrink('a', 5)
    expect(shrunk.ok).toBe(false)
    expect((await leaseDone('a')).hi).toBe(20)
    handle.kill()
  })

  it('dead-letters a corrupt input after its attempts and keeps going', async () => {
    const taskDir = await makeTask('corrupt', 4, [1])
    const handle = await started()
    const { items, leaseDone } = collect(handle)
    handle.assign(assignment(taskDir, 'a', 0, 4), 10_000)
    await leaseDone('a')
    const dead = items.find((i) => !i.ok) as ItemDead
    expect(dead.item).toBe(1)
    expect(dead.attempts).toBe(3)
    expect(items.filter((i) => i.ok).map((i) => i.item)).toEqual([0, 2, 3])
    handle.kill()
  })

  it('runs queued assignments one after another in the same process', async () => {
    const taskDir = await makeTask('queue', 6)
    const handle = await started()
    const { items, leaseDone } = collect(handle)
    handle.assign(assignment(taskDir, 'a', 0, 3), 10_000)
    handle.assign(assignment(taskDir, 'b', 3, 6), 10_000)
    await leaseDone('b')
    expect(items.map((i) => `${i.lease}${i.item}`)).toEqual(['a0', 'a1', 'a2', 'b3', 'b4', 'b5'])
    expect(handle.idle).toBe(true)
    handle.kill()
  })

  it('reports a crash with the item that was in flight', async () => {
    const taskDir = await makeTask('crash', 30)
    const handle = await started()
    const { exited } = collect(handle)
    handle.assign(assignment(taskDir, 'a', 0, 30), 10_000)
    await new Promise<void>((resolve) => handle.once('item', () => resolve()))
    process.kill(handle.pid, 'SIGKILL')
    const exit = await exited
    expect(exit.reason).toBe('crash')
    expect(exit.inflight?.lease).toBe('a')
    expect(exit.inflight?.item).toBeGreaterThanOrEqual(1)
  })

  it('kills a worker over its memory limit', async () => {
    const taskDir = await makeTask('memory', 10)
    const handle = await started({ rssMb: 10 })
    const { exited } = collect(handle)
    handle.assign(assignment(taskDir, 'a', 0, 10), 10_000)
    expect((await exited).reason).toBe('memory')
  })

  it('kills an item that runs past its timeout', async () => {
    const taskDir = await makeTask('timeout', 100)
    const handle = await started()
    const { exited } = collect(handle)
    handle.assign(assignment(taskDir, 'a', 0, 100), 1)
    const exit = await exited
    expect(exit.reason).toBe('timeout')
    expect(exit.inflight?.lease).toBe('a')
  })

  it.skipIf(process.platform === 'win32')('kills a worker that stops sending heartbeats', async () => {
    const handle = await started({ heartbeatMs: 100, missedBeats: 3 })
    const { exited } = collect(handle)
    process.kill(handle.pid, 'SIGSTOP')
    expect((await exited).reason).toBe('heartbeat')
  })
})
