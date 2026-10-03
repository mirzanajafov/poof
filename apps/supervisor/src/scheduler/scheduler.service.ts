import { randomUUID } from 'node:crypto'
import {
  Injectable,
  Logger,
  NotFoundException,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { admits, Breaker, emptyEstimate, expectedCostMs, itemTimeoutMs, serverCostModels, updateEstimate, type Estimate } from '@poof/core'
import type { PresetName } from '@poof/imaging'
import { WorkerHandle, type ItemDead, type ItemDone, type LeaseDone, type WorkerExit } from '@poof/worker'
import type { Env } from '../config/env.js'
import { Datasets } from '../datasets/datasets.service.js'
import { Database, Events } from '../infra/infra.module.js'
import { exitColumn } from '../workers/exit.js'

export interface SubmitRequest {
  dataset: string
  preset: PresetName
  deadlineSeconds: number
  count?: number
  offset?: number
}

export type SubmitResult =
  | { accepted: true; id: string; items: number; predictedSeconds: number }
  | { accepted: false; id: string | null; reason: string; retryAfterSeconds: number; code: 429 | 503 }

type Settings = Pick<
  Env,
  | 'BUDGET'
  | 'CAPACITY_CORES'
  | 'CHUNK_ITEMS'
  | 'MAX_ATTEMPTS'
  | 'DEAD_LETTER_SHARE'
  | 'RECYCLE_ITEMS'
  | 'WORKER_RSS_MB'
  | 'CHECKPOINT_MS'
  | 'MAX_TASK_ITEMS'
>

type TaskStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'
type LeaseState = 'PENDING' | 'RUNNING' | 'DONE'

interface TaskState {
  id: string
  preset: PresetName
  items: number
  submittedAt: number
  deadline: number
  dir: string
  predicted: Float64Array
  remainingMs: number
  done: number
  dead: number
  attempts: Map<number, number>
  leases: Lease[]
  status: TaskStatus
  dirty: boolean
}

interface Lease {
  id: string
  task: TaskState
  lo: number
  hi: number
  cursor: number
  state: LeaseState
  worker: PoolWorker | null
  dirty: boolean
}

interface PoolWorker {
  id: string
  handle: WorkerHandle
  lease: Lease | null
  items: number
  retiring: boolean
}


@Injectable()
export class Scheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(Scheduler.name)
  private readonly settings: Settings
  private readonly tasks = new Map<string, TaskState>()
  private readonly workers = new Set<PoolWorker>()
  private readonly breakers = new Map<string, Breaker>()
  private readonly ratios = new Map<string, Estimate>()
  private writes: Promise<unknown> = Promise.resolve()
  private timers: NodeJS.Timeout[] = []
  private stopping = false
  private pausedUntil = 0

  constructor(
    config: ConfigService<Env, true>,
    private readonly db: Database,
    private readonly events: Events,
    private readonly datasets: Datasets,
  ) {
    this.settings = {
      BUDGET: config.get('BUDGET', { infer: true }),
      CAPACITY_CORES: config.get('CAPACITY_CORES', { infer: true }),
      CHUNK_ITEMS: config.get('CHUNK_ITEMS', { infer: true }),
      MAX_ATTEMPTS: config.get('MAX_ATTEMPTS', { infer: true }),
      DEAD_LETTER_SHARE: config.get('DEAD_LETTER_SHARE', { infer: true }),
      RECYCLE_ITEMS: config.get('RECYCLE_ITEMS', { infer: true }),
      WORKER_RSS_MB: config.get('WORKER_RSS_MB', { infer: true }),
      CHECKPOINT_MS: config.get('CHECKPOINT_MS', { infer: true }),
      MAX_TASK_ITEMS: config.get('MAX_TASK_ITEMS', { infer: true }),
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.recover()
    this.timers.push(setInterval(() => this.checkpoint(), this.settings.CHECKPOINT_MS))
    this.timers.push(setInterval(() => this.events.snapshot('poof:live', this.snapshot()), 1000))
    for (let i = 0; i < this.settings.BUDGET; i++) void this.spawn()
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true
    for (const timer of this.timers) clearInterval(timer)
    const exits = [...this.workers].map((worker) => new Promise<void>((resolve) => worker.handle.once('exit', () => resolve())))
    for (const worker of this.workers) worker.handle.kill('killed')
    await Promise.all(exits)
    this.checkpoint()
    await this.writes
  }

  async submit(request: SubmitRequest, options: { exhibitId?: string } = {}): Promise<SubmitResult> {
    if (this.pausedUntil > 0) {
      const retryAfterSeconds = Math.max(1, Math.ceil((this.pausedUntil - Date.now()) / 1000))
      return { accepted: false, id: null, reason: 'an exhibit is running', retryAfterSeconds, code: 503 }
    }
    const dataset = await this.datasets.get(request.dataset)
    const model = serverCostModels[request.preset]
    if (!model) throw new NotFoundException(`no cost model for ${request.preset}`)
    const offset = request.offset ?? 0
    const count = Math.min(request.count ?? dataset.items.length, this.settings.MAX_TASK_ITEMS)
    const items = this.datasets.select(dataset, offset, count)
    const predicted = Float64Array.from(items, (item) => expectedCostMs(model, (item.width * item.height) / 1e6))
    const predictedMs = predicted.reduce((sum, v) => sum + v, 0)
    const now = Date.now()
    const id = randomUUID()
    const deadline = now + request.deadlineSeconds * 1000
    const backlog = this.active().map((t) => ({ id: t.id, deadline: t.deadline, workMs: t.remainingMs * this.ratio(t.preset) }))
    const candidate = { id, deadline, workMs: predictedMs * this.ratio(request.preset) }
    const base = {
      id,
      dataset: dataset.name,
      offset,
      preset: request.preset,
      items: items.length,
      policy: 'pool',
      exhibitId: options.exhibitId ?? null,
      predictedMs,
      submittedAt: new Date(now),
      deadline: new Date(deadline),
    }
    if (!admits(candidate, backlog, now, this.settings.CAPACITY_CORES)) {
      const backlogMs = backlog.reduce((sum, w) => sum + w.workMs, 0)
      const retryAfterSeconds = Math.max(1, Math.ceil(backlogMs / this.settings.CAPACITY_CORES / 1000))
      await this.db.client.task.create({ data: { ...base, status: 'REJECTED' } })
      await this.db.client.decision.create({
        data: { kind: 'reject', taskId: id, detail: { workMs: candidate.workMs, backlogMs, retryAfterSeconds } },
      })
      this.events.publish('task.rejected', { task: id, retryAfterSeconds })
      return { accepted: false, id, reason: 'the box cannot finish this before its deadline', retryAfterSeconds, code: 429 }
    }
    const dir = await this.datasets.createTask(id, dataset, items)
    const task: TaskState = {
      id,
      preset: request.preset,
      items: items.length,
      submittedAt: now,
      deadline,
      dir,
      predicted,
      remainingMs: predictedMs,
      done: 0,
      dead: 0,
      attempts: new Map(),
      leases: [],
      status: 'QUEUED',
      dirty: false,
    }
    for (let lo = 0; lo < task.items; lo += this.settings.CHUNK_ITEMS) {
      const hi = Math.min(task.items, lo + this.settings.CHUNK_ITEMS)
      task.leases.push({ id: randomUUID(), task, lo, hi, cursor: lo, state: 'PENDING', worker: null, dirty: false })
    }
    await this.db.client.$transaction([
      this.db.client.task.create({ data: base }),
      this.db.client.lease.createMany({
        data: task.leases.map((l) => ({ id: l.id, taskId: id, lo: l.lo, hi: l.hi, cursor: l.cursor })),
      }),
    ])
    this.tasks.set(id, task)
    this.events.publish('task.accepted', { task: id, items: task.items, deadline })
    this.dispatch()
    return { accepted: true, id, items: task.items, predictedSeconds: Math.round(predictedMs / 1000) }
  }

  async pause(untilMs: number): Promise<void> {
    this.pausedUntil = untilMs
    const exits = [...this.workers].map((w) => new Promise<void>((resolve) => w.handle.once('exit', () => resolve())))
    for (const worker of this.workers) {
      worker.retiring = true
      if (!worker.lease) worker.handle.stop()
    }
    await Promise.all(exits)
  }

  resume(): void {
    this.pausedUntil = 0
    for (let i = this.workers.size; i < this.settings.BUDGET; i++) void this.spawn()
  }

  get paused(): boolean {
    return this.pausedUntil > 0
  }

  health() {
    return {
      ok: !this.stopping,
      paused: this.paused,
      workers: this.workers.size,
      budget: this.settings.BUDGET,
      tasks: this.active().length,
    }
  }

  snapshot() {
    return {
      at: Date.now(),
      budget: this.settings.BUDGET,
      workers: [...this.workers].map((w) => ({
        id: w.id,
        pid: w.handle.pid,
        items: w.items,
        task: w.lease?.task.id ?? null,
        lease: w.lease ? { lo: w.lease.lo, hi: w.lease.hi, cursor: w.lease.cursor } : null,
      })),
      tasks: this.active().map((t) => ({
        id: t.id,
        preset: t.preset,
        items: t.items,
        done: t.done,
        dead: t.dead,
        deadline: t.deadline,
        status: t.status,
      })),
      breakers: Object.fromEntries([...this.breakers].map(([type, b]) => [type, b.state(Date.now())])),
    }
  }

  private active(): TaskState[] {
    return [...this.tasks.values()].filter((t) => t.status === 'QUEUED' || t.status === 'RUNNING')
  }

  private ratio(preset: string): number {
    const estimate = this.ratios.get(preset)
    return estimate && estimate.count >= 5 ? estimate.mean : 1
  }

  private breaker(preset: string): Breaker {
    let breaker = this.breakers.get(preset)
    if (!breaker) {
      breaker = new Breaker()
      this.breakers.set(preset, breaker)
    }
    return breaker
  }

  private record(preset: string, ok: boolean): void {
    const breaker = this.breaker(preset)
    const before = breaker.state(Date.now())
    breaker.record(ok, Date.now())
    const after = breaker.state(Date.now())
    if (after !== before) {
      this.persist(() => this.db.client.breakerEvent.create({ data: { type: preset, state: after } }))
      this.events.publish('breaker', { preset, state: after })
    }
  }

  private persist(write: () => Promise<unknown>): void {
    this.writes = this.writes.then(write).catch((error: unknown) => this.logger.error(error))
  }

  private async spawn(): Promise<void> {
    if (this.stopping) return
    const handle = new WorkerHandle({ limits: { rssMb: this.settings.WORKER_RSS_MB } })
    try {
      await handle.start()
    } catch (error) {
      this.logger.error(`worker failed to start: ${String(error)}`)
      setTimeout(() => void this.spawn(), 1000).unref()
      return
    }
    const worker: PoolWorker = { id: randomUUID(), handle, lease: null, items: 0, retiring: false }
    this.workers.add(worker)
    this.persist(() => this.db.client.worker.create({ data: { id: worker.id, pid: handle.pid } }))
    handle.on('item', (message) => this.onItem(worker, message))
    handle.on('leaseDone', (message) => this.onLeaseDone(worker, message))
    handle.on('exit', (exit) => this.onExit(worker, exit))
    this.events.publish('worker.spawned', { worker: worker.id, pid: handle.pid })
    if (this.stopping) return handle.kill('killed')
    this.claim(worker)
  }

  private dispatch(): void {
    for (const worker of this.workers) if (!worker.lease && !worker.retiring) this.claim(worker)
  }

  private next(): Lease | null {
    const now = Date.now()
    let best: TaskState | null = null
    for (const task of this.active()) {
      if (this.breaker(task.preset).state(now) === 'open') continue
      if (!task.leases.some((l) => l.state === 'PENDING')) continue
      if (!best || rank(task, now) < rank(best, now)) best = task
    }
    if (!best || !this.breaker(best.preset).allows(now)) return null
    return best.leases.find((l) => l.state === 'PENDING') ?? null
  }

  private claim(worker: PoolWorker): void {
    if (this.stopping || this.paused || worker.lease || worker.retiring) return
    const lease = this.next()
    if (!lease) return
    const task = lease.task
    lease.state = 'RUNNING'
    lease.worker = worker
    worker.lease = lease
    if (task.status === 'QUEUED') {
      task.status = 'RUNNING'
      this.persist(() => this.db.client.task.update({ where: { id: task.id }, data: { status: 'RUNNING', startedAt: new Date() } }))
    }
    const timeoutMs = itemTimeoutMs(task.predicted, lease.cursor, lease.hi, this.ratio(task.preset), (i) => task.attempts.get(i) ?? 0)
    worker.handle.assign(
      {
        lease: lease.id,
        task: task.id,
        taskDir: task.dir,
        preset: task.preset,
        lo: lease.cursor,
        hi: lease.hi,
        maxAttempts: this.settings.MAX_ATTEMPTS,
      },
      timeoutMs,
    )
    this.persist(() =>
      this.db.client.lease.update({ where: { id: lease.id }, data: { state: 'RUNNING', workerId: worker.id, cursor: lease.cursor } }),
    )
    this.events.publish('lease.claimed', { task: task.id, lease: lease.id, worker: worker.id, lo: lease.cursor, hi: lease.hi })
  }

  private onItem(worker: PoolWorker, message: ItemDone | ItemDead): void {
    const lease = worker.lease
    if (!lease || lease.id !== message.lease) return
    const task = lease.task
    worker.items++
    if (message.ok) {
      task.done++
      const ratio = this.ratios.get(task.preset) ?? emptyEstimate
      this.ratios.set(task.preset, updateEstimate(ratio, message.cpuMs / task.predicted[message.item]!, 0.05))
      this.record(task.preset, true)
    } else {
      this.deadLetter(task, message.item, message.attempts, message.error)
    }
    task.remainingMs -= task.predicted[message.item]!
    lease.cursor = message.item + 1
    lease.dirty = true
    task.dirty = true
    this.events.publish('item', { task: task.id, item: message.item, ok: message.ok, worker: worker.id })
    this.settle(task)
  }

  private deadLetter(task: TaskState, item: number, attempts: number, error: string): void {
    task.dead++
    this.record(task.preset, false)
    this.persist(() => this.db.client.deadLetter.create({ data: { taskId: task.id, item, attempts, error: error.slice(0, 500) } }))
    this.events.publish('item.dead', { task: task.id, item, attempts, error: error.slice(0, 200) })
    if (task.dead > this.settings.DEAD_LETTER_SHARE * task.items) this.fail(task, 'too many dead letters')
  }

  private onLeaseDone(worker: PoolWorker, message: LeaseDone): void {
    const lease = worker.lease
    if (!lease || lease.id !== message.lease) return
    lease.state = 'DONE'
    lease.cursor = Math.max(lease.cursor, message.hi)
    lease.worker = null
    worker.lease = null
    this.persist(() => this.db.client.lease.update({ where: { id: lease.id }, data: { state: 'DONE', cursor: lease.cursor } }))
    this.settle(lease.task)
    if (worker.retiring || worker.items >= this.settings.RECYCLE_ITEMS) {
      worker.retiring = true
      worker.handle.stop()
      return
    }
    this.claim(worker)
  }

  private onExit(worker: PoolWorker, exit: WorkerExit): void {
    this.workers.delete(worker)
    this.persist(() =>
      this.db.client.worker.update({
        where: { id: worker.id },
        data: { endedAt: new Date(), exit: exitColumn[exit.reason], items: worker.items },
      }),
    )
    this.events.publish('worker.exit', { worker: worker.id, reason: exit.reason, inflight: exit.inflight })
    const lease = worker.lease
    if (lease) this.release(lease, exit)
    if (!this.stopping && !this.paused) void this.spawn()
  }

  private release(lease: Lease, exit: WorkerExit): void {
    const task = lease.task
    lease.worker = null
    if (exit.inflight && exit.inflight.lease === lease.id && exit.reason !== 'normal' && !this.stopping) {
      const item = exit.inflight.item
      const attempts = (task.attempts.get(item) ?? 0) + 1
      task.attempts.set(item, attempts)
      this.persist(() =>
        this.db.client.decision.create({ data: { kind: 'worker-exit', taskId: task.id, detail: { reason: exit.reason, item, attempts } } }),
      )
      if (attempts >= this.settings.MAX_ATTEMPTS) {
        this.deadLetter(task, item, attempts, `worker ${exit.reason}`)
        task.remainingMs -= task.predicted[item]!
        lease.cursor = item + 1
      } else {
        this.record(task.preset, false)
        lease.cursor = item
      }
    }
    const open = task.status === 'QUEUED' || task.status === 'RUNNING'
    lease.state = open && lease.cursor < lease.hi ? 'PENDING' : 'DONE'
    this.persist(() =>
      this.db.client.lease.update({ where: { id: lease.id }, data: { state: lease.state, cursor: lease.cursor, workerId: null } }),
    )
    this.settle(task)
    this.dispatch()
  }

  cancel(ids: readonly string[], reason: string): number {
    let cancelled = 0
    for (const id of ids) {
      const task = this.tasks.get(id)
      if (!task || (task.status !== 'QUEUED' && task.status !== 'RUNNING')) continue
      this.fail(task, reason, 'cancel')
      cancelled++
    }
    return cancelled
  }

  flush(): Promise<unknown> {
    return this.writes
  }

  private fail(task: TaskState, reason: string, kind = 'fail'): void {
    if (task.status === 'DONE' || task.status === 'FAILED') return
    task.status = 'FAILED'
    for (const lease of task.leases) {
      if (lease.state === 'PENDING') lease.state = 'DONE'
      else if (lease.state === 'RUNNING' && lease.worker) void lease.worker.handle.shrink(lease.id, lease.cursor + 1)
    }
    this.persist(() =>
      this.db.client.$transaction([
        this.db.client.task.update({
          where: { id: task.id },
          data: { status: 'FAILED', finishedAt: new Date(), done: task.done, deadLettered: task.dead },
        }),
        this.db.client.lease.updateMany({ where: { taskId: task.id, state: 'PENDING' }, data: { state: 'DONE' } }),
        this.db.client.decision.create({ data: { kind, taskId: task.id, detail: { reason, dead: task.dead } } }),
      ]),
    )
    this.events.publish('task.failed', { task: task.id, reason })
    this.forgetLater(task)
  }

  private settle(task: TaskState): void {
    if (task.status !== 'RUNNING' && task.status !== 'QUEUED') return
    if (task.done + task.dead < task.items) return
    task.status = 'DONE'
    const finishedAt = new Date()
    this.persist(() =>
      this.db.client.task.update({
        where: { id: task.id },
        data: { status: 'DONE', finishedAt, done: task.done, deadLettered: task.dead },
      }),
    )
    this.events.publish('task.done', { task: task.id, met: finishedAt.getTime() <= task.deadline, dead: task.dead })
    this.forgetLater(task)
  }

  private forgetLater(task: TaskState): void {
    setTimeout(() => {
      if (task.leases.every((l) => l.state === 'DONE')) this.tasks.delete(task.id)
    }, 60_000).unref()
  }

  private checkpoint(): void {
    const leases: Lease[] = []
    const tasks: TaskState[] = []
    for (const task of this.tasks.values()) {
      if (task.dirty && (task.status === 'RUNNING' || task.status === 'QUEUED')) tasks.push(task)
      task.dirty = false
      for (const lease of task.leases) {
        if (lease.dirty && lease.state === 'RUNNING') leases.push(lease)
        lease.dirty = false
      }
    }
    if (leases.length === 0 && tasks.length === 0) return
    const updates = leases.map((l) => ({ id: l.id, cursor: l.cursor }))
    const counts = tasks.map((t) => ({ id: t.id, done: t.done, dead: t.dead }))
    this.persist(() =>
      this.db.client.$transaction([
        ...updates.map((u) => this.db.client.lease.update({ where: { id: u.id }, data: { cursor: u.cursor } })),
        ...counts.map((c) => this.db.client.task.update({ where: { id: c.id }, data: { done: c.done, deadLettered: c.dead } })),
      ]),
    )
  }

  private async recover(): Promise<void> {
    await this.db.client.worker.updateMany({ where: { endedAt: null }, data: { endedAt: new Date(), exit: 'KILLED' } })
    const rows = await this.db.client.task.findMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      include: { leases: true, deadLetters: { select: { item: true } } },
    })
    for (const row of rows) {
      const dataset = await this.datasets.get(row.dataset).catch(() => null)
      const model = serverCostModels[row.preset]
      if (!dataset || !model) {
        await this.db.client.$transaction([
          this.db.client.task.update({ where: { id: row.id }, data: { status: 'FAILED', finishedAt: new Date() } }),
          this.db.client.lease.updateMany({ where: { taskId: row.id, state: { not: 'DONE' } }, data: { state: 'DONE' } }),
          this.db.client.decision.create({ data: { kind: 'fail', taskId: row.id, detail: { reason: 'dataset gone after a restart' } } }),
        ])
        continue
      }
      const items = this.datasets.select(dataset, row.offset, row.items)
      const predicted = Float64Array.from(items, (item) => expectedCostMs(model, (item.width * item.height) / 1e6))
      const task: TaskState = {
        id: row.id,
        preset: row.preset as PresetName,
        items: row.items,
        submittedAt: row.submittedAt.getTime(),
        deadline: row.deadline.getTime(),
        dir: this.datasets.taskDir(row.id),
        predicted,
        remainingMs: 0,
        done: 0,
        dead: row.deadLetters.length,
        attempts: new Map(),
        leases: [],
        status: row.status === 'RUNNING' ? 'RUNNING' : 'QUEUED',
        dirty: true,
      }
      let processed = 0
      for (const l of row.leases) {
        const state: LeaseState = l.state === 'DONE' ? 'DONE' : 'PENDING'
        task.leases.push({ id: l.id, task, lo: l.lo, hi: l.hi, cursor: l.cursor, state, worker: null, dirty: false })
        processed += (state === 'DONE' ? l.hi : l.cursor) - l.lo
        if (state === 'PENDING') for (let i = l.cursor; i < l.hi; i++) task.remainingMs += predicted[i]!
      }
      task.leases.sort((a, b) => a.lo - b.lo)
      task.done = processed - task.dead
      this.tasks.set(task.id, task)
      this.settle(task)
    }
    await this.db.client.lease.updateMany({ where: { state: 'RUNNING' }, data: { state: 'PENDING', workerId: null } })
    if (rows.length > 0) this.logger.log(`recovered ${rows.length} unfinished tasks`)
  }
}

function rank(task: TaskState, now: number): number {
  return (task.deadline <= now ? 1e15 : 0) + task.deadline
}

