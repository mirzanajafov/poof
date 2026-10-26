import { randomUUID } from 'node:crypto'
import { emptyExhibitStats, type ExhibitSnapshot, type ExhibitStats, type ManifestItem } from '@poof/contracts'
import {
  admits,
  Breakers,
  decide,
  emptyEstimate,
  grant,
  itemTimeoutMs,
  planSplit,
  predictedCostMs,
  updateEstimate,
  type Estimate,
  type LeaseInfo,
  type PolicyConfig,
  type Preemption,
  type PresetName,
  type SplitRequest,
  type StartRequest,
  type TaskInfo,
} from '@poof/core'
import { SpanStatusCode, within, type Context, type Span, type Tracer } from '@poof/tracing'
import { WorkerHandle, type ExitReport, type ItemDead, type ItemDone, type LeaseDone } from '@poof/worker'
import type { Dataset, Datasets } from '../datasets/datasets.service.js'
import type { Events } from '../infra/events.js'
import { Task, type TaskLease } from '../tasks/task.js'
import { TaskBook } from '../tasks/task-book.js'
import type { LeaseRow, TaskStore } from '../tasks/task-store.js'

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
  tracer: Tracer
  trace?: Context
}

interface SplitLease extends TaskLease {
  readonly task: Task<SplitLease>
  readonly parentId: string | null
  readonly depth: number
  worker: ExhibitWorker | null
  span: Span
  startedAt: number | null
  lastSplitAt: number | null
  itemsDone: number
  itemMs: Estimate
  busy: boolean
}

interface ExhibitWorker {
  id: string
  handle: WorkerHandle
  lease: SplitLease | null
  yielding: boolean
  items: number
}

export class LeaseEngine {
  private readonly book: TaskBook<SplitLease>
  private readonly leases = new Map<string, SplitLease>()
  private readonly workers = new Set<ExhibitWorker>()
  private readonly counters = emptyExhibitStats()
  private spawnEstimate: Estimate = emptyEstimate
  private reserved = 0
  private timer: NodeJS.Timeout | null = null
  private stopped = false

  constructor(
    private readonly options: EngineOptions,
    private readonly store: TaskStore,
    private readonly events: Events,
    private readonly datasets: Datasets,
  ) {
    this.book = new TaskBook(
      store,
      events,
      options.tracer,
      new Breakers<PresetName>(options.policy.breaker),
      {
        maxAttempts: options.maxAttempts,
        deadLetterShare: options.deadLetterShare,
        deadLetter: options.policy.deadLetter,
      },
      (lease) => this.stopLease(lease),
    )
  }

  start(): void {
    this.timer = setInterval(() => this.tick(), this.options.tickMs)
  }

  get processes(): number {
    return this.workers.size + this.reserved
  }

  get stats(): ExhibitStats {
    return { ...this.counters, ...this.book.counts }
  }

  async submit(
    dataset: Dataset,
    items: ManifestItem[],
    preset: PresetName,
    deadlineMs: number,
    offset: number,
  ): Promise<boolean> {
    const now = Date.now()
    const id = randomUUID()
    const task = new Task<SplitLease>({
      id,
      preset,
      items: items.length,
      submittedAt: now,
      deadline: deadlineMs,
      dir: this.datasets.taskDir(id),
      predicted: Float64Array.from(items, (item) => predictedCostMs(preset, item)),
      span: this.options.tracer.startSpan(
        'task',
        {
          startTime: now,
          attributes: {
            'poof.task': id,
            'poof.dataset': dataset.name,
            'poof.preset': preset,
            'poof.items': items.length,
            'poof.offset': offset,
          },
        },
        this.options.trace,
      ),
    })
    const placement = {
      dataset: dataset.name,
      offset,
      policy: this.options.policy.name,
      exhibitId: this.options.exhibitId,
    }
    if (this.options.policy.admission) {
      const backlog = this.book.active().map((t) => ({ id: t.id, deadline: t.deadline, workMs: t.remainingMs }))
      const candidate = { id, deadline: deadlineMs, workMs: task.remainingMs }
      if (!admits(candidate, backlog, now, this.options.capacityCores)) {
        this.counters.submitted++
        this.counters.rejected++
        const backlogMs = backlog.reduce((sum, work) => sum + work.workMs, 0)
        await this.book.reject(task, placement, { workMs: candidate.workMs, backlogMs })
        return false
      }
    }
    await this.datasets.createTask(id, dataset, items)
    if (this.stopped) {
      task.span.end()
      await this.datasets.removeTask(id)
      return false
    }
    const size = Math.ceil(task.items / Math.max(1, this.options.policy.upfront))
    for (let lo = 0; lo < task.items; lo += size) this.newLease(task, lo, Math.min(task.items, lo + size), null, 0)
    await this.book.accept(task, placement, task.leases.map(leaseRow))
    this.counters.submitted++
    for (const lease of task.leases) {
      this.leases.set(lease.id, lease)
      this.announce(lease)
    }
    return true
  }

  async stop(): Promise<ExhibitStats> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    const exits = [...this.workers].map((worker) => worker.handle.exited)
    for (const worker of this.workers) worker.handle.kill('killed')
    await Promise.race([Promise.all(exits), new Promise((resolve) => setTimeout(resolve, 5000))])
    for (const task of this.book.active()) this.book.fail(task, 'exhibit ended', 'cancel')
    for (const lease of this.leases.values()) if (lease.state !== 'done') lease.span.end()
    await this.store.flush()
    return this.stats
  }

  snapshot(): Pick<ExhibitSnapshot, 'budget' | 'processes' | 'stats' | 'tasks'> {
    return {
      budget: this.options.policy.budget ? this.options.budget : null,
      processes: this.workers.size,
      stats: this.stats,
      tasks: this.book.active().map((t) => ({
        id: t.id,
        items: t.items,
        done: t.done,
        deadline: t.deadline,
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

  private get spawnMs(): number {
    return this.spawnEstimate.count > 0 ? this.spawnEstimate.mean : 180
  }

  private newLease(task: Task<SplitLease>, lo: number, hi: number, parent: SplitLease | null, depth: number) {
    const id = randomUUID()
    const lease: SplitLease = {
      id,
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
      itemsDone: 0,
      itemMs: emptyEstimate,
      busy: false,
      span: this.options.tracer.startSpan(
        'lease',
        { attributes: { 'poof.lease': id, 'poof.lo': lo, 'poof.hi': hi, 'poof.depth': depth } },
        within(parent ? parent.span : task.span),
      ),
    }
    task.leases.push(lease)
    this.counters.maxDepth = Math.max(this.counters.maxDepth, depth)
    return lease
  }

  private createLease(task: Task<SplitLease>, lo: number, hi: number, parent: SplitLease, depth: number) {
    const lease = this.newLease(task, lo, hi, parent, depth)
    this.leases.set(lease.id, lease)
    this.store.leaseCreated(task.id, leaseRow(lease))
    this.announce(lease)
    return lease
  }

  private announce(lease: SplitLease): void {
    this.events.publish({
      kind: 'lease.created',
      task: lease.task.id,
      lease: lease.id,
      parent: lease.parentId,
      depth: lease.depth,
      lo: lease.lo,
      hi: lease.hi,
    })
  }

  private tick(): void {
    if (this.stopped) return
    const now = Date.now()
    const policy = this.options.policy
    const breakers = this.book.breakers
    const tasks = new Map<string, TaskInfo>()
    const infos: LeaseInfo[] = []
    for (const task of this.book.active()) {
      tasks.set(task.id, {
        id: task.id,
        type: task.preset,
        items: task.items,
        submittedAt: task.submittedAt,
        deadline: task.deadline,
      })
      for (const lease of task.leases) {
        if (lease.state !== 'running' || lease.busy || lease.worker?.yielding) continue
        infos.push({
          id: lease.id,
          taskId: task.id,
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
    const requests = decide(
      { now, tasks, leases: infos, breakers: breakers.states(now), spawnMs: this.spawnMs },
      policy,
    )
    const starts: StartRequest[] = []
    for (const task of this.book.active()) {
      if (breakers.state(task.preset, now) === 'open') continue
      for (const lease of task.leases)
        if (lease.state === 'pending') starts.push({ leaseId: lease.id, deadline: task.deadline })
    }
    const free = this.options.budget - this.processes
    const grants = grant(policy, free, starts, requests, now, this.spawnMs, this.preemption())
    for (const id of grants.preempt) void this.yieldLease(this.lease(id))
    for (const request of requests) {
      const k = grants.splits.get(request.leaseId)
      if (k !== undefined) void this.split(this.lease(request.leaseId), k, request)
    }
    for (const id of grants.starts) {
      const lease = this.lease(id)
      if (lease.state === 'pending' && breakers.allows(lease.task.preset, now)) this.launch(lease)
    }
  }

  private stopLease(lease: SplitLease): void {
    void lease.worker?.handle.shrink(lease.id, lease.cursor + 1)
  }

  private lease(id: string): SplitLease {
    const lease = this.leases.get(id)
    if (!lease) throw new Error(`no lease ${id}`)
    return lease
  }

  private preemption(): Preemption | undefined {
    if (!this.options.policy.preempt) return undefined
    let yielding = 0
    const running = []
    for (const worker of this.workers) {
      if (worker.yielding) yielding++
      const lease = worker.lease
      if (worker.yielding || lease?.state !== 'running' || lease.busy || !lease.task.open) continue
      running.push({ leaseId: lease.id, deadline: lease.task.deadline, remaining: lease.hi - lease.cursor - 1 })
    }
    return { running, yielding, minRemaining: 2 }
  }

  private async split(lease: SplitLease, k: number, request: SplitRequest): Promise<void> {
    if (lease.state !== 'running' || !lease.worker || lease.busy || k < 1) return
    const plan = planSplit(Math.min(lease.cursor + 1, lease.hi), lease.hi, k, request.itemMs, this.spawnMs)
    if (!plan) return
    const workerItems = lease.worker.items
    lease.busy = true
    this.reserved += plan.children.length
    const result = await lease.worker.handle.shrink(lease.id, plan.cut)
    this.reserved -= plan.children.length
    lease.busy = false
    if (this.stopped) return
    if (!lease.task.open) {
      this.stopLease(lease)
      return
    }
    if (!result.ok) return
    lease.hi = plan.cut
    lease.lastSplitAt = Date.now()
    this.counters.splits++
    lease.span.addEvent('split', {
      'poof.k': plan.children.length,
      'poof.cut': plan.cut,
      'poof.pain': request.pain,
      'poof.worker_items': workerItems,
    })
    this.store.leaseShrunk(lease.id, lease.hi)
    this.store.decided(lease.task.id, 'split', {
      lease: lease.id,
      k: plan.children.length,
      cut: plan.cut,
      pain: request.pain,
      projectedMs: request.projectedMs,
      workerItems,
    })
    for (const range of plan.children)
      this.launch(this.createLease(lease.task, range.lo, range.hi, lease, lease.depth + 1))
  }

  private async yieldLease(lease: SplitLease): Promise<void> {
    const worker = lease.worker
    if (lease.state !== 'running' || !worker || lease.busy) return
    const cut = lease.cursor + 1
    if (cut >= lease.hi) return
    lease.busy = true
    worker.yielding = true
    const result = await worker.handle.shrink(lease.id, cut)
    lease.busy = false
    if (!lease.task.open) {
      this.stopLease(lease)
      return
    }
    if (!result.ok) {
      worker.yielding = false
      return
    }
    const rest = lease.hi
    lease.hi = cut
    this.counters.preemptions++
    lease.span.addEvent('yield', { 'poof.cut': cut })
    this.store.leaseShrunk(lease.id, cut)
    this.createLease(lease.task, cut, rest, lease, lease.depth)
  }

  private launch(lease: SplitLease): void {
    if (this.stopped) return
    if (this.workers.size >= this.options.maxProcesses) {
      this.counters.spawnFailures++
      return
    }
    lease.state = 'starting'
    const worker: ExhibitWorker = {
      id: randomUUID(),
      handle: new WorkerHandle({ limits: { rssMb: this.options.rssMb } }),
      lease,
      yielding: false,
      items: 0,
    }
    lease.worker = worker
    this.workers.add(worker)
    this.counters.peakProcesses = Math.max(this.counters.peakProcesses, this.workers.size)
    const started = Date.now()
    const spawn = this.options.tracer.startSpan(
      'spawn',
      { attributes: { 'poof.processes': this.workers.size } },
      within(lease.span),
    )
    worker.handle.start().then(
      () => {
        spawn.setAttribute('poof.worker.pid', worker.handle.pid)
        spawn.end()
        if (this.stopped || lease.state !== 'starting') {
          this.workers.delete(worker)
          lease.worker = null
          worker.handle.kill('killed')
          return
        }
        this.spawnEstimate = updateEstimate(this.spawnEstimate, Date.now() - started)
        this.counters.spawns++
        this.store.workerStarted(worker.id, worker.handle.pid)
        worker.handle.on('item', (message) => this.onItem(worker, message))
        worker.handle.on('leaseDone', (message) => this.onLeaseDone(worker, message))
        worker.handle.on('exit', (exit) => this.onExit(worker, exit))
        this.events.publish({ kind: 'worker.spawned', worker: worker.id, pid: worker.handle.pid })
        this.assign(worker, lease)
      },
      () => {
        spawn.setStatus({ code: SpanStatusCode.ERROR, message: 'spawn failed' })
        spawn.end()
        this.workers.delete(worker)
        this.counters.spawnFailures++
        lease.worker = null
        if (lease.state === 'starting') lease.state = 'pending'
      },
    )
  }

  private assign(worker: ExhibitWorker, lease: SplitLease): void {
    const task = lease.task
    lease.state = 'running'
    lease.worker = worker
    worker.lease = lease
    lease.startedAt ??= Date.now()
    this.book.start(task)
    const timeoutMs = itemTimeoutMs(task.predicted, lease.cursor, lease.hi, 1, (i) => task.attemptsAt(i))
    worker.handle.assign(
      {
        lease: lease.id,
        task: task.id,
        taskDir: task.dir,
        preset: task.preset,
        lo: lease.cursor,
        hi: lease.hi,
        maxAttempts: this.options.maxAttempts,
      },
      timeoutMs,
    )
    this.store.leaseRunning(lease.id, worker.id, lease.cursor)
  }

  private onItem(worker: ExhibitWorker, message: ItemDone | ItemDead): void {
    const lease = worker.lease
    if (lease?.id !== message.lease) return
    lease.cursor = message.item + 1
    lease.itemsDone++
    worker.items++
    if (message.ok) {
      lease.itemMs = updateEstimate(lease.itemMs, message.wallMs)
      this.book.succeeded(lease.task, lease, message)
    } else {
      this.book.failedItem(lease.task, lease, message)
    }
  }

  private onLeaseDone(worker: ExhibitWorker, message: LeaseDone): void {
    const lease = worker.lease
    if (lease?.id !== message.lease) return
    const task = lease.task
    lease.state = 'done'
    lease.cursor = Math.max(lease.cursor, message.hi)
    lease.worker = null
    worker.lease = null
    lease.span.setAttribute('poof.hi', message.hi)
    lease.span.end()
    this.store.leaseDone(lease.id, lease.cursor)
    const next = worker.yielding || this.stopped ? undefined : task.leases.find((l) => l.state === 'pending')
    if (next && task.status === 'RUNNING' && this.book.breakers.allows(task.preset, Date.now())) {
      this.counters.adoptions++
      next.startedAt ??= lease.startedAt
      if (next.itemsDone === 0) {
        next.itemsDone = lease.itemsDone
        next.itemMs = lease.itemMs
      }
      this.assign(worker, next)
      return
    }
    worker.handle.stop()
  }

  private onExit(worker: ExhibitWorker, exit: ExitReport): void {
    this.workers.delete(worker)
    this.counters.exits[exit.reason] = (this.counters.exits[exit.reason] ?? 0) + 1
    this.store.workerExited(worker.id, exit.reason, worker.items)
    this.events.publish({ kind: 'worker.exit', worker: worker.id, reason: exit.reason })
    const lease = worker.lease
    if (!lease) return
    lease.worker = null
    if (this.stopped) return
    if (exit.reason !== 'normal') {
      lease.span.addEvent('worker exit', { 'poof.reason': exit.reason, 'poof.item': exit.inflight?.item ?? -1 })
    }
    this.book.released(lease.task, lease, exit)
    if (lease.state === 'done') lease.span.end()
  }
}

function leaseRow(lease: SplitLease): LeaseRow {
  return { id: lease.id, lo: lease.lo, hi: lease.hi, parentId: lease.parentId, depth: lease.depth }
}
