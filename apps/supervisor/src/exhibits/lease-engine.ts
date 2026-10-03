import { randomUUID } from 'node:crypto'
import { Logger } from '@nestjs/common'
import {
  admits,
  allocate,
  Breaker,
  decide,
  emptyEstimate,
  expectedCostMs,
  planSplit,
  serverCostModels,
  updateEstimate,
  type BreakerState,
  type Estimate,
  type Grants,
  type LeaseInfo,
  type PolicyConfig,
  type Preemption,
  type SplitRequest,
  type StartRequest,
  type TaskInfo,
} from '@poof/core'
import type { PresetName } from '@poof/imaging'
import { WorkerHandle, type ExitReason, type ItemDead, type ItemDone, type LeaseDone, type WorkerExit } from '@poof/worker'
import type { Dataset, DatasetItem, Datasets } from '../datasets/datasets.service.js'
import type { Database, Events } from '../infra/infra.module.js'
import { exitColumn } from '../workers/exit.js'

export interface EngineOptions {
  exhibitId: string
  policy: PolicyConfig
  budget: number
  maxProcesses: number
  capacityCores: number
  maxAttempts: number
  deadLetterShare: number
  rssMb: number
  tickMs: number
}

export interface ExhibitStats {
  submitted: number
  rejected: number
  done: number
  met: number
  cancelled: number
  failed: number
  items: number
  deadLettered: number
  spawns: number
  spawnFailures: number
  splits: number
  preemptions: number
  adoptions: number
  exits: Partial<Record<ExitReason, number>>
  peakProcesses: number
  maxDepth: number
}

type Status = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'

interface ExhibitTask {
  info: TaskInfo
  preset: PresetName
  dir: string
  predicted: Float64Array
  remainingMs: number
  done: number
  dead: number
  attempts: Map<number, number>
  leases: ExhibitLease[]
  status: Status
}

interface ExhibitLease {
  id: string
  task: ExhibitTask
  parentId: string | null
  depth: number
  lo: number
  hi: number
  cursor: number
  state: 'pending' | 'starting' | 'running' | 'done'
  worker: ExhibitWorker | null
  startedAt: number | null
  lastSplitAt: number | null
  itemsDone: number
  itemMs: Estimate
  busy: boolean
}

interface ExhibitWorker {
  id: string
  handle: WorkerHandle
  lease: ExhibitLease | null
  yielding: boolean
}

export class LeaseEngine {
  private readonly logger = new Logger(LeaseEngine.name)
  private readonly tasks = new Map<string, ExhibitTask>()
  private readonly leases = new Map<string, ExhibitLease>()
  private readonly workers = new Set<ExhibitWorker>()
  private readonly breakers = new Map<string, Breaker>()
  private spawnEstimate: Estimate = emptyEstimate
  private reserved = 0
  private writes: Promise<unknown> = Promise.resolve()
  private timer: NodeJS.Timeout | null = null
  private stopped = false
  readonly stats: ExhibitStats = {
    submitted: 0,
    rejected: 0,
    done: 0,
    met: 0,
    cancelled: 0,
    failed: 0,
    items: 0,
    deadLettered: 0,
    spawns: 0,
    spawnFailures: 0,
    splits: 0,
    preemptions: 0,
    adoptions: 0,
    exits: {},
    peakProcesses: 0,
    maxDepth: 0,
  }

  constructor(
    private readonly options: EngineOptions,
    private readonly db: Database,
    private readonly events: Events,
    private readonly datasets: Datasets,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.tick(), this.options.tickMs)
  }

  get processes(): number {
    return this.workers.size + this.reserved
  }

  async submit(dataset: Dataset, items: DatasetItem[], preset: PresetName, deadlineMs: number, offset: number): Promise<boolean> {
    if (this.stopped) return false
    const model = serverCostModels[preset]!
    const predicted = Float64Array.from(items, (item) => expectedCostMs(model, (item.width * item.height) / 1e6))
    const predictedMs = predicted.reduce((sum, v) => sum + v, 0)
    const now = Date.now()
    const id = randomUUID()
    const info: TaskInfo = { id, type: preset, items: items.length, submittedAt: now, deadline: deadlineMs }
    this.stats.submitted++
    const base = {
      id,
      dataset: dataset.name,
      offset,
      preset,
      items: items.length,
      policy: this.options.policy.name,
      exhibitId: this.options.exhibitId,
      predictedMs,
      submittedAt: new Date(now),
      deadline: new Date(deadlineMs),
    }
    if (this.options.policy.admission) {
      const backlog = this.active().map((t) => ({ id: t.info.id, deadline: t.info.deadline, workMs: t.remainingMs }))
      if (!admits({ id, deadline: deadlineMs, workMs: predictedMs }, backlog, now, this.options.capacityCores)) {
        this.stats.rejected++
        this.persist(() => this.db.client.task.create({ data: { ...base, status: 'REJECTED' } }))
        this.events.publish('task.rejected', { task: id, exhibit: this.options.exhibitId })
        return false
      }
    }
    const dir = await this.datasets.createTask(id, dataset, items)
    if (this.stopped) {
      this.stats.submitted--
      await this.datasets.removeTask(id)
      return false
    }
    const task: ExhibitTask = {
      info,
      preset,
      dir,
      predicted,
      remainingMs: predictedMs,
      done: 0,
      dead: 0,
      attempts: new Map(),
      leases: [],
      status: 'QUEUED',
    }
    this.tasks.set(id, task)
    this.persist(() => this.db.client.task.create({ data: base }))
    const size = Math.ceil(task.info.items / Math.max(1, this.options.policy.upfront))
    for (let lo = 0; lo < task.info.items; lo += size) this.createLease(task, lo, Math.min(task.info.items, lo + size), null, 0)
    this.events.publish('task.accepted', { task: id, items: items.length, deadline: deadlineMs, exhibit: this.options.exhibitId })
    return true
  }

  async stop(): Promise<ExhibitStats> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    const exits = [...this.workers].map((w) => new Promise<void>((resolve) => w.handle.once('exit', () => resolve())))
    for (const worker of this.workers) worker.handle.kill('killed')
    await Promise.race([Promise.all(exits), new Promise((resolve) => setTimeout(resolve, 5000))])
    for (const task of this.active()) {
      task.status = 'FAILED'
      this.stats.cancelled++
      this.persist(() =>
        this.db.client.$transaction([
          this.db.client.task.update({
            where: { id: task.info.id },
            data: { status: 'FAILED', finishedAt: new Date(), done: task.done, deadLettered: task.dead },
          }),
          this.db.client.lease.updateMany({ where: { taskId: task.info.id, state: { not: 'DONE' } }, data: { state: 'DONE' } }),
          this.db.client.decision.create({ data: { kind: 'cancel', taskId: task.info.id, detail: { reason: 'exhibit ended' } } }),
        ]),
      )
    }
    await this.writes
    return this.stats
  }

  snapshot() {
    return {
      policy: this.options.policy.name,
      budget: this.options.policy.budget ? this.options.budget : null,
      processes: this.workers.size,
      stats: this.stats,
      tasks: this.active().map((t) => ({
        id: t.info.id,
        items: t.info.items,
        done: t.done,
        deadline: t.info.deadline,
        leases: t.leases.map((l) => ({
          id: l.id,
          parent: l.parentId,
          depth: l.depth,
          lo: l.lo,
          hi: l.hi,
          cursor: l.cursor,
          state: l.state,
          pid: l.worker?.handle.pid ?? null,
        })),
      })),
    }
  }

  private active(): ExhibitTask[] {
    return [...this.tasks.values()].filter((t) => t.status === 'QUEUED' || t.status === 'RUNNING')
  }

  private persist(write: () => Promise<unknown>): void {
    this.writes = this.writes.then(write).catch((error: unknown) => this.logger.error(error))
  }

  private breaker(type: string): Breaker {
    let breaker = this.breakers.get(type)
    if (!breaker) {
      breaker = new Breaker()
      this.breakers.set(type, breaker)
    }
    return breaker
  }

  private breakerState(type: string): BreakerState {
    return this.options.policy.breaker ? this.breaker(type).state(Date.now()) : 'closed'
  }

  private get spawnMs(): number {
    return this.spawnEstimate.count > 0 ? this.spawnEstimate.mean : 180
  }

  private createLease(task: ExhibitTask, lo: number, hi: number, parent: ExhibitLease | null, depth: number): ExhibitLease {
    const lease: ExhibitLease = {
      id: randomUUID(),
      task,
      parentId: parent?.id ?? null,
      depth,
      lo,
      hi,
      cursor: lo,
      state: 'pending',
      worker: null,
      startedAt: null,
      lastSplitAt: null,
      itemsDone: parent?.itemsDone ?? 0,
      itemMs: parent?.itemMs ?? emptyEstimate,
      busy: false,
    }
    task.leases.push(lease)
    this.leases.set(lease.id, lease)
    this.stats.maxDepth = Math.max(this.stats.maxDepth, depth)
    this.persist(() =>
      this.db.client.lease.create({
        data: { id: lease.id, taskId: task.info.id, parentId: lease.parentId, depth, lo, hi, cursor: lo },
      }),
    )
    this.events.publish('lease.created', { task: task.info.id, lease: lease.id, parent: lease.parentId, depth, lo, hi })
    return lease
  }

  private tick(): void {
    if (this.stopped) return
    const now = Date.now()
    const policy = this.options.policy
    const tasks = new Map<string, TaskInfo>()
    const infos: LeaseInfo[] = []
    for (const task of this.active()) {
      tasks.set(task.info.id, task.info)
      for (const lease of task.leases) {
        if (lease.state !== 'running' || lease.busy || lease.worker?.yielding) continue
        infos.push({
          id: lease.id,
          taskId: task.info.id,
          parentId: lease.parentId,
          depth: lease.depth,
          lo: lease.lo,
          hi: lease.hi,
          next: Math.min(lease.cursor + 1, lease.hi),
          state: 'running',
          startedAt: lease.startedAt,
          lastSplitAt: lease.lastSplitAt,
          itemsDone: lease.itemsDone,
          itemMs: lease.itemMs,
        })
      }
    }
    const breakers = new Map([...this.breakers.keys()].map((type) => [type, this.breakerState(type)] as const))
    const requests = decide({ now, tasks, leases: infos, breakers, spawnMs: this.spawnMs, killSwitch: false }, policy)
    const starts: StartRequest[] = []
    for (const task of this.active()) {
      if (this.breakerState(task.preset) === 'open') continue
      for (const lease of task.leases) if (lease.state === 'pending') starts.push({ leaseId: lease.id, deadline: task.info.deadline })
    }
    let grants: Grants
    if (policy.budget) {
      grants = allocate(this.options.budget - this.processes, starts, requests, now, this.spawnMs, policy.fanout, this.preemption())
    } else {
      grants = { starts: starts.map((s) => s.leaseId), splits: new Map(requests.map((r) => [r.leaseId, r.k])), preempt: [] }
    }
    const byLease = new Map(requests.map((r) => [r.leaseId, r]))
    for (const id of grants.preempt) void this.yieldLease(this.leases.get(id)!)
    for (const [id, k] of grants.splits) void this.split(this.leases.get(id)!, k, byLease.get(id)!)
    for (const id of grants.starts) {
      const lease = this.leases.get(id)!
      if (lease.state === 'pending' && (!policy.breaker || this.breaker(lease.task.preset).allows(now))) this.launch(lease)
    }
  }

  private preemption(): Preemption | undefined {
    if (!this.options.policy.preempt) return undefined
    let yielding = 0
    const running = []
    for (const worker of this.workers) {
      if (worker.yielding) yielding++
      const lease = worker.lease
      if (worker.yielding || !lease || lease.state !== 'running' || lease.busy) continue
      running.push({ leaseId: lease.id, deadline: lease.task.info.deadline, remaining: lease.hi - lease.cursor - 1 })
    }
    return { running, yielding, minRemaining: 2 }
  }

  private async split(lease: ExhibitLease, k: number, request: SplitRequest): Promise<void> {
    if (lease.state !== 'running' || !lease.worker || lease.busy || k < 1) return
    const plan = planSplit(Math.min(lease.cursor + 1, lease.hi), lease.hi, k, request.itemMs, this.spawnMs)
    if (!plan) return
    lease.busy = true
    this.reserved += plan.children.length
    const result = await lease.worker.handle.shrink(lease.id, plan.cut)
    this.reserved -= plan.children.length
    lease.busy = false
    if (!result.ok || this.stopped) return
    lease.hi = plan.cut
    lease.lastSplitAt = Date.now()
    this.stats.splits++
    this.persist(() => this.db.client.lease.update({ where: { id: lease.id }, data: { hi: lease.hi } }))
    this.persist(() =>
      this.db.client.decision.create({
        data: {
          kind: 'split',
          taskId: lease.task.info.id,
          detail: { lease: lease.id, k: plan.children.length, cut: plan.cut, pain: request.pain, projectedMs: request.projectedMs },
        },
      }),
    )
    for (const range of plan.children) this.launch(this.createLease(lease.task, range.lo, range.hi, lease, lease.depth + 1))
  }

  private async yieldLease(lease: ExhibitLease): Promise<void> {
    const worker = lease.worker
    if (lease.state !== 'running' || !worker || lease.busy) return
    const cut = lease.cursor + 1
    if (cut >= lease.hi) return
    lease.busy = true
    worker.yielding = true
    const result = await worker.handle.shrink(lease.id, cut)
    lease.busy = false
    if (!result.ok) {
      worker.yielding = false
      return
    }
    const rest = lease.hi
    lease.hi = cut
    this.stats.preemptions++
    this.persist(() => this.db.client.lease.update({ where: { id: lease.id }, data: { hi: cut } }))
    this.createLease(lease.task, cut, rest, lease, lease.depth)
  }

  private launch(lease: ExhibitLease): void {
    if (this.stopped) return
    if (this.workers.size >= this.options.maxProcesses) {
      this.stats.spawnFailures++
      return
    }
    lease.state = 'starting'
    const worker: ExhibitWorker = { id: randomUUID(), handle: new WorkerHandle({ limits: { rssMb: this.options.rssMb } }), lease, yielding: false }
    lease.worker = worker
    this.workers.add(worker)
    this.stats.peakProcesses = Math.max(this.stats.peakProcesses, this.workers.size)
    const started = Date.now()
    worker.handle.start().then(
      () => {
        if (this.stopped) return worker.handle.kill('killed')
        this.spawnEstimate = updateEstimate(this.spawnEstimate, Date.now() - started)
        this.stats.spawns++
        this.persist(() => this.db.client.worker.create({ data: { id: worker.id, pid: worker.handle.pid } }))
        worker.handle.on('item', (message) => this.onItem(worker, message))
        worker.handle.on('leaseDone', (message) => this.onLeaseDone(worker, message))
        worker.handle.on('exit', (exit) => this.onExit(worker, exit))
        this.events.publish('worker.spawned', { worker: worker.id, pid: worker.handle.pid, lease: lease.id })
        this.assign(worker, lease)
      },
      () => {
        this.workers.delete(worker)
        this.stats.spawnFailures++
        lease.worker = null
        if (lease.state === 'starting') lease.state = 'pending'
      },
    )
  }

  private assign(worker: ExhibitWorker, lease: ExhibitLease): void {
    const task = lease.task
    lease.state = 'running'
    lease.worker = worker
    worker.lease = lease
    lease.startedAt ??= Date.now()
    if (task.status === 'QUEUED') {
      task.status = 'RUNNING'
      this.persist(() => this.db.client.task.update({ where: { id: task.info.id }, data: { status: 'RUNNING', startedAt: new Date() } }))
    }
    let timeoutMs = 5000
    for (let i = lease.cursor; i < lease.hi; i++) timeoutMs = Math.max(timeoutMs, 10 * task.predicted[i]!)
    worker.handle.assign(
      {
        lease: lease.id,
        task: task.info.id,
        taskDir: task.dir,
        preset: task.preset,
        lo: lease.cursor,
        hi: lease.hi,
        maxAttempts: this.options.maxAttempts,
      },
      timeoutMs,
    )
    this.persist(() => this.db.client.lease.update({ where: { id: lease.id }, data: { state: 'RUNNING', workerId: worker.id } }))
  }

  private onItem(worker: ExhibitWorker, message: ItemDone | ItemDead): void {
    const lease = worker.lease
    if (!lease || lease.id !== message.lease) return
    const task = lease.task
    lease.cursor = message.item + 1
    lease.itemsDone++
    task.remainingMs -= task.predicted[message.item]!
    if (message.ok) {
      task.done++
      this.stats.items++
      lease.itemMs = updateEstimate(lease.itemMs, message.wallMs)
      if (this.options.policy.breaker) this.breaker(task.preset).record(true, Date.now())
    } else {
      this.deadLetter(task, message.item, message.attempts, message.error)
    }
    this.events.publish('item', { task: task.info.id, lease: lease.id, item: message.item, ok: message.ok })
    this.settle(task)
  }

  private deadLetter(task: ExhibitTask, item: number, attempts: number, error: string): void {
    task.dead++
    this.stats.deadLettered++
    if (this.options.policy.breaker) this.breaker(task.preset).record(false, Date.now())
    this.persist(() =>
      this.db.client.deadLetter.create({ data: { taskId: task.info.id, item, attempts, error: error.slice(0, 500) } }),
    )
  }

  private onLeaseDone(worker: ExhibitWorker, message: LeaseDone): void {
    const lease = worker.lease
    if (!lease || lease.id !== message.lease) return
    lease.state = 'done'
    lease.worker = null
    worker.lease = null
    this.persist(() => this.db.client.lease.update({ where: { id: lease.id }, data: { state: 'DONE', cursor: lease.hi } }))
    this.settle(lease.task)
    const next = worker.yielding || this.stopped ? undefined : lease.task.leases.find((l) => l.state === 'pending')
    if (next && lease.task.status === 'RUNNING') {
      this.stats.adoptions++
      next.itemsDone = Math.max(next.itemsDone, lease.itemsDone)
      next.itemMs = next.itemMs.count > 0 ? next.itemMs : lease.itemMs
      this.assign(worker, next)
      return
    }
    worker.handle.stop()
  }

  private onExit(worker: ExhibitWorker, exit: WorkerExit): void {
    this.workers.delete(worker)
    this.stats.exits[exit.reason] = (this.stats.exits[exit.reason] ?? 0) + 1
    this.persist(() =>
      this.db.client.worker.update({
        where: { id: worker.id },
        data: { endedAt: new Date(), exit: exitColumn[exit.reason] },
      }),
    )
    this.events.publish('worker.exit', { worker: worker.id, reason: exit.reason })
    const lease = worker.lease
    if (!lease || this.stopped) return
    const task = lease.task
    lease.worker = null
    if (exit.inflight && exit.inflight.lease === lease.id && exit.reason !== 'normal') {
      const item = exit.inflight.item
      const attempts = (task.attempts.get(item) ?? 0) + 1
      task.attempts.set(item, attempts)
      if (this.options.policy.deadLetter && attempts >= this.options.maxAttempts) {
        this.deadLetter(task, item, attempts, `worker ${exit.reason}`)
        task.remainingMs -= task.predicted[item]!
        lease.cursor = item + 1
      } else {
        if (this.options.policy.breaker) this.breaker(task.preset).record(false, Date.now())
        lease.cursor = item
      }
    }
    const open = task.status === 'QUEUED' || task.status === 'RUNNING'
    lease.state = open && lease.cursor < lease.hi ? 'pending' : 'done'
    this.persist(() =>
      this.db.client.lease.update({
        where: { id: lease.id },
        data: { state: lease.state === 'done' ? 'DONE' : 'PENDING', cursor: lease.cursor, workerId: null },
      }),
    )
    if (this.options.policy.deadLetter && task.dead > this.options.deadLetterShare * task.info.items) this.fail(task)
    this.settle(task)
  }

  private fail(task: ExhibitTask): void {
    if (task.status !== 'QUEUED' && task.status !== 'RUNNING') return
    task.status = 'FAILED'
    this.stats.failed++
    for (const lease of task.leases) if (lease.state === 'pending') lease.state = 'done'
    this.persist(() =>
      this.db.client.task.update({
        where: { id: task.info.id },
        data: { status: 'FAILED', finishedAt: new Date(), done: task.done, deadLettered: task.dead },
      }),
    )
  }

  private settle(task: ExhibitTask): void {
    if (task.status !== 'QUEUED' && task.status !== 'RUNNING') return
    if (task.done + task.dead < task.info.items) return
    task.status = 'DONE'
    const finishedAt = Date.now()
    const met = finishedAt <= task.info.deadline
    this.stats.done++
    if (met) this.stats.met++
    this.persist(() =>
      this.db.client.task.update({
        where: { id: task.info.id },
        data: { status: 'DONE', finishedAt: new Date(finishedAt), done: task.done, deadLettered: task.dead },
      }),
    )
    this.events.publish('task.done', { task: task.info.id, met, exhibit: this.options.exhibitId })
  }
}

