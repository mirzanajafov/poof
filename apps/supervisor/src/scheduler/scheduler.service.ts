import { randomUUID } from 'node:crypto'
import { Injectable, Logger, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common'
import type { PoolSnapshot } from '@poof/contracts'
import {
  admits,
  Breakers,
  isPresetName,
  itemTimeoutMs,
  predictedCostMs,
  priorWorkRatio,
  updateWorkRatio,
  workRatio,
  type PresetName,
  type WorkRatio,
} from '@poof/core'
import { NotFoundError, Traces } from '@poof/nest'
import { resume, SpanStatusCode, within, type Context } from '@poof/tracing'
import { WorkerHandle, type ExitReport, type ItemDead, type ItemDone, type LeaseDone } from '@poof/worker'
import { Env } from '../config/env.js'
import { Datasets, type Dataset } from '../datasets/datasets.service.js'
import { Events } from '../infra/events.js'
import { Task, type TaskLease } from '../tasks/task.js'
import { TaskBook } from '../tasks/task-book.js'
import { TaskStore } from '../tasks/task-store.js'

export interface SubmitRequest {
  dataset: string
  preset: PresetName
  deadlineSeconds: number
  count?: number
  offset?: number
}

export type SubmitRefusal = 'paused' | 'over-capacity'

export type SubmitResult =
  | { accepted: true; id: string; items: number; predictedSeconds: number }
  | {
      accepted: false
      id: string | null
      refusal: SubmitRefusal
      reason: string
      retryAfterSeconds: number
    }

interface Chunk extends TaskLease {
  readonly task: Task<Chunk>
  worker: PoolWorker | null
}

interface PoolWorker {
  id: string
  handle: WorkerHandle
  lease: Chunk | null
  items: number
  retiring: boolean
}

const forgetAfterMs = 60_000

@Injectable()
export class Scheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(Scheduler.name)
  private readonly book: TaskBook<Chunk>
  private readonly workers = new Set<PoolWorker>()
  private readonly ratios = new Map<PresetName, WorkRatio>()
  private readonly changed = new Set<Task<Chunk>>()
  private readonly moved = new Set<Chunk>()
  private timers: NodeJS.Timeout[] = []
  private stopping = false
  private pausedUntil = 0

  constructor(
    private readonly env: Env,
    private readonly store: TaskStore,
    private readonly events: Events,
    private readonly datasets: Datasets,
    private readonly traces: Traces,
  ) {
    this.book = new TaskBook(
      store,
      events,
      traces.tracer,
      new Breakers<PresetName>(),
      { maxAttempts: this.env.MAX_ATTEMPTS, deadLetterShare: this.env.DEAD_LETTER_SHARE, deadLetter: true },
      (chunk) => void chunk.worker?.handle.shrink(chunk.id, chunk.cursor + 1),
    )
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.recover()
    this.timers.push(
      setInterval(() => {
        this.checkpoint()
        this.book.forget(Date.now() - forgetAfterMs)
      }, this.env.CHECKPOINT_MS),
    )
    this.timers.push(setInterval(() => this.events.savePoolSnapshot(this.snapshot()), 1000))
    for (let i = 0; i < this.env.BUDGET; i++) void this.spawn()
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true
    for (const timer of this.timers) clearInterval(timer)
    const exits = [...this.workers].map((worker) => worker.handle.exited)
    for (const worker of this.workers) worker.handle.kill('killed')
    await Promise.all(exits)
    this.checkpoint()
    await this.store.flush()
  }

  async submit(request: SubmitRequest, options: { exhibitId?: string; trace?: Context } = {}): Promise<SubmitResult> {
    if (this.paused) {
      const retryAfterSeconds = Math.max(1, Math.ceil((this.pausedUntil - Date.now()) / 1000))
      return { accepted: false, id: null, refusal: 'paused', reason: 'an exhibit is running', retryAfterSeconds }
    }
    const dataset = await this.datasets.get(request.dataset)
    const offset = request.offset ?? 0
    const count = Math.min(request.count ?? dataset.items.length, this.env.MAX_TASK_ITEMS)
    const items = this.datasets.select(dataset, offset, count)
    const now = Date.now()
    const id = randomUUID()
    const predicted = Float64Array.from(items, (item) => predictedCostMs(request.preset, item))
    const task = new Task<Chunk>({
      id,
      preset: request.preset,
      items: items.length,
      submittedAt: now,
      deadline: now + request.deadlineSeconds * 1000,
      dir: this.datasets.taskDir(id),
      predicted,
      span: this.traces.tracer.startSpan(
        'task',
        {
          startTime: now,
          attributes: {
            'poof.task': id,
            'poof.dataset': dataset.name,
            'poof.preset': request.preset,
            'poof.items': items.length,
            'poof.deadline_s': request.deadlineSeconds,
            'poof.predicted_ms': Math.round(predicted.reduce((sum, ms) => sum + ms, 0)),
          },
        },
        options.trace,
      ),
    })
    const placement = { dataset: dataset.name, offset, policy: 'pool', exhibitId: options.exhibitId ?? null }
    const backlog = this.book.active().map((t) => ({ id: t.id, deadline: t.deadline, workMs: this.workMs(t) }))
    const workMs = this.workMs(task)
    if (!admits({ id, deadline: task.deadline, workMs }, backlog, now, this.env.WORKER_CPU_CORES)) {
      const backlogMs = backlog.reduce((sum, w) => sum + w.workMs, 0)
      const retryAfterSeconds = Math.max(1, Math.ceil(backlogMs / this.env.WORKER_CPU_CORES / 1000))
      task.span.setAttributes({ 'poof.work_ms': Math.round(workMs), 'poof.retry_after_s': retryAfterSeconds })
      await this.book.reject(task, placement, { workMs, backlogMs, retryAfterSeconds })
      return {
        accepted: false,
        id,
        refusal: 'over-capacity',
        reason: 'the box cannot finish this before its deadline',
        retryAfterSeconds,
      }
    }
    await this.datasets.createTask(id, dataset, items)
    for (let lo = 0; lo < task.items; lo += this.env.CHUNK_ITEMS) {
      const hi = Math.min(task.items, lo + this.env.CHUNK_ITEMS)
      task.leases.push({ id: randomUUID(), task, lo, hi, cursor: lo, state: 'pending', worker: null, span: null })
    }
    await this.book.accept(
      task,
      placement,
      task.leases.map((l) => ({ id: l.id, lo: l.lo, hi: l.hi, parentId: null, depth: 0 })),
    )
    this.dispatch()
    return { accepted: true, id, items: task.items, predictedSeconds: Math.round(task.remainingMs / 1000) }
  }

  async pause(untilMs: number): Promise<void> {
    this.pausedUntil = untilMs
    const exits = [...this.workers].map((worker) => worker.handle.exited)
    for (const worker of this.workers) {
      worker.retiring = true
      if (!worker.lease) worker.handle.stop()
    }
    await Promise.all(exits)
  }

  resume(): void {
    this.pausedUntil = 0
    for (let i = this.workers.size; i < this.env.BUDGET; i++) void this.spawn()
  }

  get paused(): boolean {
    return this.pausedUntil > 0
  }

  cancel(ids: readonly string[], reason: string): number {
    let cancelled = 0
    for (const id of ids) {
      const task = this.book.tasks.get(id)
      if (!task?.open) continue
      this.book.fail(task, reason, 'cancel')
      cancelled++
    }
    return cancelled
  }

  health() {
    return {
      ok: !this.stopping,
      paused: this.paused,
      workers: this.workers.size,
      budget: this.env.BUDGET,
      tasks: this.book.active().length,
    }
  }

  snapshot(): PoolSnapshot {
    return {
      at: Date.now(),
      budget: this.env.BUDGET,
      workers: [...this.workers].map((w) => ({
        id: w.id,
        pid: w.handle.pid,
        items: w.items,
        task: w.lease?.task.id ?? null,
        lease: w.lease ? { lo: w.lease.lo, hi: w.lease.hi, cursor: w.lease.cursor } : null,
      })),
      tasks: this.book.active().map((t) => ({
        id: t.id,
        preset: t.preset,
        items: t.items,
        done: t.done,
        dead: t.dead,
        deadline: t.deadline,
      })),
      breakers: Object.fromEntries(this.book.breakers.states(Date.now())),
    }
  }

  private workMs(task: Task<Chunk>): number {
    return task.remainingMs * this.ratio(task.preset)
  }

  private ratio(preset: PresetName): number {
    return workRatio(this.ratios.get(preset) ?? this.prior())
  }

  private prior(): WorkRatio {
    return priorWorkRatio(this.env.ADMISSION_PRIOR_RATIO, 20 * 300)
  }

  private async spawn(): Promise<void> {
    if (this.stopping || this.paused) return
    const handle = new WorkerHandle({ limits: { rssMb: this.env.WORKER_RSS_MB } })
    try {
      await handle.start()
    } catch (error) {
      this.logger.error('a worker failed to start', error)
      setTimeout(() => void this.spawn(), 1000).unref()
      return
    }
    this.addWorker(handle)
  }

  private addWorker(handle: WorkerHandle): void {
    if (this.stopping || this.paused) {
      handle.kill('killed')
      return
    }
    const worker: PoolWorker = { id: randomUUID(), handle, lease: null, items: 0, retiring: false }
    this.workers.add(worker)
    this.store.workerStarted(worker.id, handle.pid)
    handle.on('item', (message) => this.onItem(worker, message))
    handle.on('leaseDone', (message) => this.onLeaseDone(worker, message))
    handle.on('exit', (exit) => this.onExit(worker, exit))
    this.events.publish({ kind: 'worker.spawned', worker: worker.id, pid: handle.pid })
    this.claim(worker)
  }

  private dispatch(): void {
    for (const worker of this.workers) if (!worker.lease && !worker.retiring) this.claim(worker)
  }

  private next(): Chunk | null {
    const now = Date.now()
    const breakers = this.book.breakers
    let best: Task<Chunk> | null = null
    for (const task of this.book.active()) {
      if (breakers.state(task.preset, now) === 'open') continue
      if (!task.leases.some((l) => l.state === 'pending')) continue
      if (!best || rank(task, now) < rank(best, now)) best = task
    }
    if (!best || !breakers.allows(best.preset, now)) return null
    return best.leases.find((l) => l.state === 'pending') ?? null
  }

  private claim(worker: PoolWorker): void {
    if (this.stopping || this.paused || worker.lease || worker.retiring) return
    const lease = this.next()
    if (!lease) return
    const task = lease.task
    lease.state = 'running'
    lease.worker = worker
    worker.lease = lease
    this.book.start(task)
    const timeoutMs = itemTimeoutMs(task.predicted, lease.cursor, lease.hi, this.ratio(task.preset), (i) =>
      task.attemptsAt(i),
    )
    lease.span = this.traces.tracer.startSpan(
      'chunk',
      {
        attributes: {
          'poof.lease': lease.id,
          'poof.lo': lease.cursor,
          'poof.hi': lease.hi,
          'poof.worker.pid': worker.handle.pid,
          'poof.timeout_ms': Math.round(timeoutMs),
        },
      },
      within(task.span),
    )
    worker.handle.assign(
      {
        lease: lease.id,
        task: task.id,
        taskDir: task.dir,
        preset: task.preset,
        lo: lease.cursor,
        hi: lease.hi,
        maxAttempts: this.env.MAX_ATTEMPTS,
      },
      timeoutMs,
    )
    this.store.leaseRunning(lease.id, worker.id, lease.cursor)
    this.events.publish({
      kind: 'lease.claimed',
      task: task.id,
      lease: lease.id,
      worker: worker.id,
      lo: lease.cursor,
      hi: lease.hi,
    })
  }

  private onItem(worker: PoolWorker, message: ItemDone | ItemDead): void {
    const lease = worker.lease
    if (lease?.id !== message.lease) return
    const task = lease.task
    worker.items++
    lease.cursor = message.item + 1
    this.moved.add(lease)
    this.changed.add(task)
    if (message.ok) {
      const ratio = this.ratios.get(task.preset) ?? this.prior()
      this.ratios.set(task.preset, updateWorkRatio(ratio, message.stepCpuMs, task.costOf(message.item)))
      this.book.succeeded(task, lease, message)
    } else {
      this.book.failedItem(task, lease, message)
    }
  }

  private onLeaseDone(worker: PoolWorker, message: LeaseDone): void {
    const lease = worker.lease
    if (lease?.id !== message.lease) return
    lease.state = 'done'
    lease.cursor = Math.max(lease.cursor, message.hi)
    lease.worker = null
    worker.lease = null
    lease.span?.end()
    lease.span = null
    this.store.leaseDone(lease.id, lease.cursor)
    if (worker.retiring || worker.items >= this.env.RECYCLE_ITEMS) {
      worker.retiring = true
      worker.handle.stop()
      return
    }
    this.claim(worker)
  }

  private onExit(worker: PoolWorker, exit: ExitReport): void {
    this.workers.delete(worker)
    this.store.workerExited(worker.id, exit.reason, worker.items)
    this.events.publish({ kind: 'worker.exit', worker: worker.id, reason: exit.reason })
    const lease = worker.lease
    if (lease) {
      if (exit.reason !== 'normal')
        lease.span?.setStatus({ code: SpanStatusCode.ERROR, message: `worker ${exit.reason}` })
      lease.span?.end()
      lease.span = null
      lease.worker = null
      if (this.stopping) {
        this.book.putBack(lease.task, lease)
      } else {
        this.book.released(lease.task, lease, exit)
        this.dispatch()
      }
    }
    if (!this.stopping && !this.paused) void this.spawn()
  }

  private checkpoint(): void {
    const leases = [...this.moved].filter((l) => l.state === 'running').map((l) => ({ id: l.id, cursor: l.cursor }))
    const tasks = [...this.changed].filter((t) => t.open).map((t) => ({ id: t.id, done: t.done, dead: t.dead }))
    this.moved.clear()
    this.changed.clear()
    this.store.checkpoint(leases, tasks)
  }

  private async recover(): Promise<void> {
    await this.store.releaseAfterRestart()
    const rows = await this.store.unfinishedTasks()
    for (const row of rows) {
      const progress = { id: row.id, done: row.done, dead: row.deadLettered }
      let dataset: Dataset
      try {
        dataset = await this.datasets.get(row.dataset)
      } catch (error) {
        const gone = error instanceof NotFoundError
        if (!gone) this.logger.error(`could not read dataset ${row.dataset}`, error)
        const reason = gone ? 'dataset gone' : `dataset ${row.dataset} unreadable`
        this.store.failed(progress, 'fail', `${reason} after a restart`, new Date())
        continue
      }
      if (!isPresetName(row.preset)) {
        this.store.failed(progress, 'fail', `no preset ${row.preset} after a restart`, new Date())
        continue
      }
      const preset = row.preset
      const predicted = Float64Array.from(this.datasets.select(dataset, row.offset, row.items), (item) =>
        predictedCostMs(preset, item),
      )
      const task = new Task<Chunk>({
        id: row.id,
        preset,
        items: row.items,
        submittedAt: row.submittedAt.getTime(),
        deadline: row.deadline.getTime(),
        dir: this.datasets.taskDir(row.id),
        predicted,
        span: this.traces.tracer.startSpan(
          'task',
          { attributes: { 'poof.task': row.id, 'poof.items': row.items, 'poof.resumed': true } },
          row.traceId ? resume(row.traceId) : undefined,
        ),
      })
      for (const l of row.leases) {
        const state = l.state === 'DONE' ? 'done' : 'pending'
        task.leases.push({ id: l.id, task, lo: l.lo, hi: l.hi, cursor: l.cursor, state, worker: null, span: null })
      }
      task.restore(row.status === 'RUNNING' ? 'RUNNING' : 'QUEUED', row.deadLetters.length)
      this.changed.add(task)
      this.book.track(task)
    }
    await this.store.flush()
    if (rows.length > 0) this.logger.log(`recovered ${rows.length} unfinished tasks`)
  }
}

function rank(task: Task<Chunk>, now: number): number {
  return (task.deadline <= now ? 1e15 : 0) + task.deadline
}
