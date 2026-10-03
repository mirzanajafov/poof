import {
  admits,
  allocate,
  Breaker,
  decide,
  emptyEstimate,
  defaultTimeoutRule,
  expectedCostMs,
  itemTimeoutMs,
  planSplit,
  updateEstimate,
  type BreakerState,
  type Estimate,
  type Grants,
  type Preemption,
  type RunningLease,
  type LeaseInfo,
  type PolicyConfig,
  type SplitRequest,
  type StartRequest,
  type TaskInfo,
  type TimeoutRule,
  type View,
} from '@poof/core'
import { curveFor, effectiveCores, type Calibration, type Curve } from './calibration.ts'
import { inWindow, Workload, type Arrivals, type Scenario, type TaskPlan } from './workload.ts'

export interface MachineSpec {
  name: string
  cores: number
  memoryMb: number
  supervisorMb: number
  maxProcesses: number
}

export interface SimOptions {
  scenario: Scenario
  machine: MachineSpec
  policy: PolicyConfig
  calibration: Calibration
  seed: number
  dtMs?: number
  tickMs?: number
  sampleMs?: number
  budget?: number
  maxAttempts?: number
  deadLetterShare?: number
  recordSeries?: boolean
  checkInvariants?: boolean
  itemTimeouts?: boolean
  warmPool?: boolean
  timeoutRule?: TimeoutRule
  arrivals?: Arrivals
}

export interface TaskOutcome {
  id: string
  type: string
  items: number
  skewed: boolean
  submittedAt: number
  deadline: number
  finishedAt: number | null
  rejected: boolean
  failed: boolean
  met: boolean
  lateness: number
  deadLettered: number
  done: number
  workers: number
}

export interface Sample {
  t: number
  processes: number
  running: number
  pending: number
  goodput: number
  backlogMs: number
  oomKills: number
  spawns: number
}

export interface RunResult {
  scenario: string
  machine: string
  policy: string
  seed: number
  budget: number
  endedAt: number
  tasks: TaskOutcome[]
  cpu: { usefulMs: number; spawnMs: number; lostMs: number }
  counts: {
    spawns: number
    spawnFailures: number
    splits: number
    adoptions: number
    claims: number
    crashes: number
    oomKills: number
    timeouts: number
    deadLettered: number
    breakerOpened: number
    preemptions: number
  }
  peaks: { processes: number; depth: number }
  series: Sample[]
}

type LeaseState = 'pending' | 'starting' | 'running' | 'done'
type ProcessState = 'starting' | 'busy' | 'idle' | 'gone'

interface SimTask {
  plan: TaskPlan
  info: TaskInfo
  state: Uint8Array
  attempts: Uint8Array
  done: number
  dead: number
  remainingMs: number
  predicted: Float64Array
  predictedMs: number
  rejected: boolean
  failed: boolean
  finishedAt: number | null
  leases: SimLease[]
}

interface SimLease {
  id: number
  task: SimTask
  parentId: number | null
  depth: number
  lo: number
  hi: number
  cursor: number
  inflight: boolean
  inflightLeft: number
  inflightStart: number
  timeoutMs: number
  state: LeaseState
  process: SimProcess | null
  startedAt: number | null
  lastSplitAt: number | null
  itemsDone: number
  itemMs: Estimate
}

interface SimProcess {
  id: number
  state: ProcessState
  spawnLeft: number
  spawnedAt: number
  lease: SimLease | null
  rss: number
  items: number
  yielding: boolean
}

const TODO = 0
const DONE = 1
const DEAD = 2

export class Simulation {
  readonly options: Required<Omit<SimOptions, 'budget' | 'arrivals'>> & { budget: number }
  private readonly workload: Arrivals
  private readonly curve: Curve
  private readonly policy: PolicyConfig
  private readonly machine: MachineSpec
  private now = 0
  private nextLeaseId = 1
  private nextProcessId = 1
  private readonly tasks: SimTask[] = []
  private readonly active = new Set<SimTask>()
  private readonly processes = new Set<SimProcess>()
  private readonly breakers = new Map<string, Breaker>()
  private readonly typeRatio = new Map<string, Estimate>()
  private spawnEstimate: Estimate = emptyEstimate
  private readonly cpu = { usefulMs: 0, spawnMs: 0, lostMs: 0 }
  private readonly counts = {
    spawns: 0,
    spawnFailures: 0,
    splits: 0,
    adoptions: 0,
    claims: 0,
    crashes: 0,
    oomKills: 0,
    timeouts: 0,
    deadLettered: 0,
    breakerOpened: 0,
    preemptions: 0,
  }
  private readonly peaks = { processes: 0, depth: 0 }
  private readonly series: Sample[] = []
  private usefulSinceSample = 0

  constructor(options: SimOptions) {
    this.policy = options.policy
    this.machine = options.machine
    this.curve = curveFor(options.calibration, options.machine.cores)
    this.workload =
      options.arrivals ?? new Workload(options.scenario, options.calibration.types, options.machine.cores, options.seed)
    this.options = {
      dtMs: 10,
      tickMs: 250,
      sampleMs: 1000,
      maxAttempts: 3,
      deadLetterShare: 0.05,
      recordSeries: false,
      checkInvariants: false,
      itemTimeouts: false,
      warmPool: false,
      timeoutRule: defaultTimeoutRule,
      ...options,
      budget: options.budget ?? defaultBudget(options.calibration, options.machine),
    }
  }

  run(): RunResult {
    const { dtMs, tickMs, sampleMs } = this.options
    const end = this.workload.scenario.arrivalsMs + this.workload.scenario.drainMs
    let nextArrival = this.workload.nextArrival()
    let nextTick = 0
    let nextSample = sampleMs
    if (this.policy.engine === 'pool') this.fillPool(this.options.warmPool)
    for (this.now = dtMs; this.now <= end; this.now += dtMs) {
      while (nextArrival !== null && nextArrival <= this.now) {
        this.arrive(nextArrival)
        nextArrival = this.workload.nextArrival()
      }
      if (this.now >= nextTick) {
        this.tick()
        nextTick += tickMs
      }
      this.step(dtMs)
      this.enforceMemory()
      if (this.now >= nextSample) {
        this.sample()
        nextSample += sampleMs
      }
      if (nextArrival === null && this.active.size === 0) break
    }
    return this.result(Math.min(this.now, end))
  }

  private get cores(): number {
    const neighbour = this.workload.scenario.neighbour
    return this.machine.cores * (inWindow(neighbour, this.now) ? neighbour!.capacity : 1)
  }

  private get spawnMs(): number {
    return this.spawnEstimate.count > 0 ? this.spawnEstimate.mean : this.options.calibration.spawnMs
  }

  private breaker(type: string): Breaker {
    let breaker = this.breakers.get(type)
    if (!breaker) {
      breaker = new Breaker()
      this.breakers.set(type, breaker)
    }
    return breaker
  }

  private correction(type: string): number {
    const estimate = this.typeRatio.get(type)
    return estimate && estimate.count > 0 ? estimate.mean : 1
  }

  private arrive(at: number): void {
    const plan = this.workload.task(at)
    const items = plan.costs.length
    const cost = this.options.calibration.types[plan.type]!
    const predicted = new Float64Array(items)
    let remainingMs = 0
    let predictedMs = 0
    for (let i = 0; i < items; i++) {
      remainingMs += plan.costs[i]!
      predicted[i] = expectedCostMs(cost, plan.mp[i]!)
      predictedMs += predicted[i]!
    }
    const task: SimTask = {
      predicted,
      predictedMs,
      plan,
      info: { id: plan.id, type: plan.type, items, submittedAt: plan.submittedAt, deadline: plan.deadline },
      state: new Uint8Array(items),
      attempts: new Uint8Array(items),
      done: 0,
      dead: 0,
      remainingMs,
      rejected: false,
      failed: false,
      finishedAt: null,
      leases: [],
    }
    this.tasks.push(task)
    if (this.policy.admission && !this.admit(task)) {
      task.rejected = true
      return
    }
    this.active.add(task)
    const size = this.policy.engine === 'pool' ? this.policy.chunk : Math.ceil(items / Math.max(1, this.policy.upfront))
    for (let lo = 0; lo < items; lo += size) this.createLease(task, lo, Math.min(items, lo + size), null, 0)
    if (this.policy.engine === 'pool') for (const process of this.processes) if (process.state === 'idle') this.claim(process)
  }

  private admit(task: SimTask): boolean {
    const admitted = [...this.active].map((t) => ({
      id: t.info.id,
      deadline: t.info.deadline,
      workMs: t.predictedMs * this.correction(t.info.type),
    }))
    const candidate = { id: task.info.id, deadline: task.info.deadline, workMs: task.predictedMs * this.correction(task.info.type) }
    const capacity = effectiveCores(this.curve, this.options.budget, this.machine.cores)
    return admits(candidate, admitted, this.now, capacity)
  }

  private createLease(task: SimTask, lo: number, hi: number, parent: SimLease | null, depth: number): SimLease {
    const lease: SimLease = {
      id: this.nextLeaseId++,
      task,
      parentId: parent?.id ?? null,
      depth,
      lo,
      hi,
      cursor: lo,
      inflight: false,
      inflightLeft: 0,
      inflightStart: 0,
      timeoutMs: 0,
      state: 'pending',
      process: null,
      startedAt: null,
      lastSplitAt: null,
      itemsDone: 0,
      itemMs: emptyEstimate,
    }
    task.leases.push(lease)
    this.peaks.depth = Math.max(this.peaks.depth, depth)
    return lease
  }

  private liveProcesses(): number {
    return this.processes.size
  }

  private spawn(lease: SimLease | null): SimProcess | null {
    if (this.liveProcesses() >= this.machine.maxProcesses) {
      this.counts.spawnFailures++
      return null
    }
    const process: SimProcess = {
      id: this.nextProcessId++,
      state: 'starting',
      spawnLeft: this.options.calibration.spawnMs,
      spawnedAt: this.now,
      lease,
      rss: this.options.calibration.baseRssMb,
      items: 0,
      yielding: false,
    }
    this.processes.add(process)
    this.counts.spawns++
    this.peaks.processes = Math.max(this.peaks.processes, this.processes.size)
    if (lease) {
      lease.process = process
      lease.timeoutMs = this.itemTimeout(lease)
      lease.state = 'starting'
    }
    return process
  }

  private fillPool(warm = false): void {
    while (this.processes.size < this.options.budget) {
      const process = this.spawn(null)
      if (!process) break
      if (warm) {
        this.counts.spawns--
        process.spawnLeft = 0
        process.state = 'idle'
      }
    }
  }

  private breakerState(type: string): BreakerState {
    return this.policy.breaker ? this.breaker(type).state(this.now) : 'closed'
  }

  private breakerAllows(type: string): boolean {
    return !this.policy.breaker || this.breaker(type).allows(this.now)
  }

  private view(): View {
    const tasks = new Map<string, TaskInfo>()
    const leases: LeaseInfo[] = []
    const speed = this.currentSpeed()
    for (const task of this.active) {
      tasks.set(task.info.id, task.info)
      for (const lease of task.leases) {
        if (lease.state !== 'running') continue
        const info: LeaseInfo = {
          id: String(lease.id),
          taskId: task.info.id,
          parentId: lease.parentId === null ? null : String(lease.parentId),
          depth: lease.depth,
          lo: lease.lo,
          hi: lease.hi,
          next: lease.cursor + (lease.inflight ? 1 : 0),
          state: 'running',
          startedAt: lease.startedAt,
          lastSplitAt: lease.lastSplitAt,
          itemsDone: lease.itemsDone,
          itemMs: lease.itemMs,
        }
        if (this.policy.trigger === 'oracle') {
          let remaining = 0
          for (let i = info.next; i < lease.hi; i++) if (task.state[i] === TODO) remaining += task.plan.costs[i]!
          info.trueRemainingMs = remaining / speed
        }
        leases.push(info)
      }
    }
    const breakers = new Map<string, BreakerState>()
    for (const type of this.breakers.keys()) breakers.set(type, this.breakerState(type))
    return { now: this.now, tasks, leases, breakers, spawnMs: this.spawnMs, killSwitch: false }
  }

  private currentSpeed(): number {
    const consumers = this.consumers().length
    return consumers === 0 ? 1 : effectiveCores(this.curve, consumers, this.cores) / consumers
  }

  private tick(): void {
    if (this.policy.engine === 'pool') {
      this.fillPool()
      for (const process of this.processes) if (process.state === 'idle') this.claim(process)
      return
    }
    const requests = decide(this.view(), this.policy)
    const pending: SimLease[] = []
    for (const task of this.active) {
      for (const lease of task.leases) {
        if (lease.state === 'pending' && this.breakerState(task.info.type) !== 'open') pending.push(lease)
      }
    }
    const starts: StartRequest[] = pending.map((lease) => ({ leaseId: String(lease.id), deadline: lease.task.info.deadline }))
    let grants: Grants
    if (this.policy.budget) {
      const free = this.options.budget - this.liveProcesses()
      grants = allocate(free, starts, requests, this.now, this.spawnMs, this.policy.fanout, this.preemption())
    } else {
      grants = {
        starts: starts.map((s) => s.leaseId),
        splits: new Map(requests.map((r) => [r.leaseId, r.k])),
        preempt: [],
      }
    }
    const byId = new Map<string, SimLease>()
    for (const task of this.active) for (const lease of task.leases) byId.set(String(lease.id), lease)
    const requestById = new Map(requests.map((r) => [r.leaseId, r]))
    for (const leaseId of grants.preempt) this.yieldLease(byId.get(leaseId)!)
    for (const [leaseId, k] of grants.splits) this.applySplit(byId.get(leaseId)!, k, requestById.get(leaseId)!)
    for (const leaseId of grants.starts) {
      const lease = byId.get(leaseId)!
      if (lease.state !== 'pending' || !this.breakerAllows(lease.task.info.type)) continue
      this.spawn(lease)
    }
  }

  private preemption(): Preemption | undefined {
    if (!this.policy.preempt) return undefined
    const running: RunningLease[] = []
    let yielding = 0
    for (const process of this.processes) {
      if (process.yielding) yielding++
      const lease = process.lease
      if (process.yielding || !lease || lease.state !== 'running') continue
      running.push({
        leaseId: String(lease.id),
        deadline: lease.task.info.deadline,
        remaining: lease.hi - lease.cursor - (lease.inflight ? 1 : 0),
      })
    }
    return { running, yielding, minRemaining: 2 }
  }

  private yieldLease(lease: SimLease): void {
    const process = lease.process
    if (lease.state !== 'running' || !process) return
    const next = lease.cursor + (lease.inflight ? 1 : 0)
    if (next >= lease.hi) return
    this.createLease(lease.task, next, lease.hi, null, lease.depth)
    lease.hi = next
    process.yielding = true
    this.counts.preemptions++
    if (!lease.inflight) this.finishLease(lease)
  }

  private applySplit(lease: SimLease, k: number, request: SplitRequest): void {
    if (lease.state !== 'running' || k < 1) return
    const next = lease.cursor + (lease.inflight ? 1 : 0)
    const plan = planSplit(next, lease.hi, k, request.itemMs, this.spawnMs)
    if (!plan) return
    lease.hi = plan.cut
    lease.lastSplitAt = this.now
    this.counts.splits++
    for (const range of plan.children) {
      const child = this.createLease(lease.task, range.lo, range.hi, lease, lease.depth + 1)
      this.spawn(child)
    }
  }

  private consumers(): SimProcess[] {
    const out: SimProcess[] = []
    for (const process of this.processes) {
      if (process.state === 'starting' || (process.state === 'busy' && process.lease?.inflight)) out.push(process)
    }
    return out
  }

  private step(dt: number): void {
    const consumers = this.consumers()
    if (consumers.length === 0) return
    const work = (dt * effectiveCores(this.curve, consumers.length, this.cores)) / consumers.length
    for (const process of consumers) {
      if (process.state === 'starting') {
        const used = Math.min(work, process.spawnLeft)
        process.spawnLeft -= used
        this.cpu.spawnMs += (used * this.options.calibration.spawnCpuMs) / this.options.calibration.spawnMs
        if (process.spawnLeft <= 1e-9) this.ready(process)
      } else {
        this.advance(process, work)
      }
    }
    if (this.options.itemTimeouts) this.enforceTimeouts()
  }

  private itemTimeout(lease: SimLease): number {
    const scale = this.policy.engine === 'pool' ? this.correction(lease.task.info.type) : 1
    const task = lease.task
    return itemTimeoutMs(task.predicted, lease.cursor, lease.hi, scale, (i) => task.attempts[i]!, this.options.timeoutRule)
  }

  private enforceTimeouts(): void {
    for (const process of [...this.processes]) {
      const lease = process.lease
      if (process.state !== 'busy' || !lease?.inflight) continue
      if (this.now - lease.inflightStart > lease.timeoutMs) this.crash(process, 'timeout')
    }
  }

  private ready(process: SimProcess): void {
    this.spawnEstimate = updateEstimate(this.spawnEstimate, this.now - process.spawnedAt)
    const lease = process.lease
    if (!lease) {
      process.state = 'idle'
      this.claim(process)
      return
    }
    process.state = 'busy'
    lease.state = 'running'
    lease.startedAt ??= this.now
    this.startItem(process, lease)
  }

  private startItem(process: SimProcess, lease: SimLease): void {
    const task = lease.task
    while (lease.cursor < lease.hi && task.state[lease.cursor] !== TODO) lease.cursor++
    if (lease.cursor >= lease.hi || task.failed) {
      this.finishLease(lease)
      return
    }
    lease.inflight = true
    lease.inflightLeft = task.plan.costs[lease.cursor]!
    lease.inflightStart = this.now
  }

  private advance(process: SimProcess, work: number): void {
    let left = work
    while (left > 0 && process.state === 'busy' && process.lease?.inflight) {
      const lease = process.lease
      const used = Math.min(left, lease.inflightLeft)
      lease.inflightLeft -= used
      left -= used
      if (lease.inflightLeft <= 1e-9) this.completeItem(process, lease)
    }
  }

  private crashesOn(task: SimTask, item: number): boolean {
    if (task.plan.poison[item]) return true
    const outage = this.workload.scenario.poison?.outage
    return outage !== undefined && outage.type === task.info.type && inWindow(outage, this.now)
  }

  private completeItem(process: SimProcess, lease: SimLease): void {
    const task = lease.task
    const item = lease.cursor
    if (this.crashesOn(task, item)) {
      this.crash(process, 'crash')
      return
    }
    const cost = task.plan.costs[item]!
    task.state[item] = DONE
    task.done++
    task.remainingMs -= cost
    task.predictedMs -= task.predicted[item]!
    this.cpu.usefulMs += cost
    this.usefulSinceSample += cost
    lease.inflight = false
    lease.cursor++
    lease.itemsDone++
    process.items++
    process.rss = workerMemoryMb(this.options.calibration, process.items)
    lease.itemMs = updateEstimate(lease.itemMs, this.now - lease.inflightStart)
    const ratio = this.typeRatio.get(task.info.type) ?? emptyEstimate
    this.typeRatio.set(task.info.type, updateEstimate(ratio, cost / task.predicted[item]!, 0.02))
    if (this.policy.breaker) this.breaker(task.info.type).record(true, this.now)
    this.settle(task)
    this.startItem(process, lease)
  }

  private crash(process: SimProcess, cause: 'crash' | 'oom' | 'timeout'): void {
    const lease = process.lease
    const starting = process.state === 'starting'
    if (cause === 'oom') this.counts.oomKills++
    else if (cause === 'timeout') this.counts.timeouts++
    else this.counts.crashes++
    this.removeProcess(process)
    if (lease) this.releaseAfterCrash(lease, starting)
    if (this.policy.engine === 'pool') this.fillPool()
  }

  private releaseAfterCrash(lease: SimLease, starting: boolean): void {
    lease.process = null
    if (starting || !lease.inflight) {
      lease.state = 'pending'
      return
    }
    const task = lease.task
    const item = lease.cursor
    this.cpu.lostMs += task.plan.costs[item]! - lease.inflightLeft
    lease.inflight = false
    task.attempts[item] = Math.min(255, task.attempts[item]! + 1)
    if (this.policy.breaker) {
      const breaker = this.breaker(task.info.type)
      const before = breaker.opened
      breaker.record(false, this.now)
      this.counts.breakerOpened += breaker.opened - before
    }
    if (this.policy.deadLetter && task.attempts[item]! >= this.options.maxAttempts) {
      task.state[item] = DEAD
      task.dead++
      task.remainingMs -= task.plan.costs[item]!
      task.predictedMs -= task.predicted[item]!
      this.counts.deadLettered++
      lease.cursor++
      if (task.dead > this.options.deadLetterShare * task.info.items) this.fail(task)
    }
    if (lease.cursor < lease.hi && !task.failed) lease.state = 'pending'
    else lease.state = 'done'
    this.settle(task)
  }

  private removeProcess(process: SimProcess): void {
    this.processes.delete(process)
    process.state = 'gone'
  }

  private finishLease(lease: SimLease): void {
    const process = lease.process
    lease.state = 'done'
    lease.inflight = false
    lease.process = null
    if (!process) return
    process.lease = null
    if (this.policy.engine === 'pool') {
      process.state = 'idle'
      this.claim(process)
      return
    }
    const task = lease.task
    const next = task.failed || process.yielding ? undefined : task.leases.find((l) => l.state === 'pending')
    if (next && this.breakerAllows(task.info.type)) {
      this.counts.adoptions++
      next.state = 'running'
      next.process = process
      next.timeoutMs = this.itemTimeout(next)
      process.lease = next
      next.startedAt ??= lease.startedAt
      if (next.itemsDone === 0) {
        next.itemMs = lease.itemMs
        next.itemsDone = lease.itemsDone
      }
      this.startItem(process, next)
      return
    }
    this.removeProcess(process)
  }

  private claim(process: SimProcess): void {
    let best: SimLease | null = null
    let bestKey: [number, number] = [Infinity, Infinity]
    for (const task of this.active) {
      if (this.breakerState(task.info.type) === 'open') continue
      const key: [number, number] = [task.info.deadline <= this.now ? 1 : 0, task.info.deadline]
      if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] >= bestKey[1])) continue
      const lease = task.leases.find((l) => l.state === 'pending')
      if (!lease) continue
      best = lease
      bestKey = key
    }
    if (!best || !this.breakerAllows(best.task.info.type)) {
      process.state = 'idle'
      return
    }
    this.counts.claims++
    best.state = 'running'
    best.process = process
    best.timeoutMs = this.itemTimeout(best)
    best.startedAt ??= this.now
    process.lease = best
    process.state = 'busy'
    this.startItem(process, best)
  }

  private fail(task: SimTask): void {
    task.failed = true
    for (const lease of task.leases) {
      const process = lease.process
      if (lease.state === 'running' && process) {
        if (lease.inflight) this.cpu.lostMs += task.plan.costs[lease.cursor]! - lease.inflightLeft
        lease.inflight = false
        this.finishLease(lease)
      } else if (lease.state === 'starting' && process) {
        lease.process = null
        process.lease = null
        if (this.policy.engine === 'lease') this.removeProcess(process)
      }
      lease.state = 'done'
    }
    this.settle(task)
  }

  private settle(task: SimTask): void {
    if (task.finishedAt !== null) return
    if (task.failed || task.done + task.dead === task.info.items) {
      task.finishedAt = this.now
      this.active.delete(task)
    }
  }

  private enforceMemory(): void {
    const limit = this.machine.memoryMb - this.machine.supervisorMb
    let total = 0
    for (const process of this.processes) total += process.rss
    while (total > limit && this.processes.size > 0) {
      let victim: SimProcess | null = null
      for (const process of this.processes) if (!victim || process.rss > victim.rss) victim = process
      total -= victim!.rss
      this.crash(victim!, 'oom')
    }
  }

  private sample(): void {
    let running = 0
    let pending = 0
    let backlogMs = 0
    for (const task of this.active) {
      backlogMs += task.remainingMs
      for (const lease of task.leases) {
        if (lease.state === 'running') running++
        else if (lease.state === 'pending') pending++
      }
    }
    if (this.options.recordSeries) {
      this.series.push({
        t: this.now,
        processes: this.processes.size,
        running,
        pending,
        goodput: this.usefulSinceSample / (this.options.sampleMs * this.machine.cores),
        backlogMs,
        oomKills: this.counts.oomKills,
        spawns: this.counts.spawns,
      })
    }
    this.usefulSinceSample = 0
    if (this.options.checkInvariants) this.checkInvariants()
  }

  checkInvariants(): void {
    for (const task of this.active) {
      const owner = new Int32Array(task.info.items)
      for (const lease of task.leases) {
        if (lease.state === 'done') continue
        for (let i = lease.cursor; i < lease.hi; i++) {
          if (owner[i] !== 0) throw new Error(`item ${i} of ${task.info.id} owned by two leases`)
          owner[i] = lease.id
        }
      }
      for (let i = 0; i < task.info.items; i++) {
        if (task.state[i] === TODO && owner[i] === 0) throw new Error(`item ${i} of ${task.info.id} has no lease`)
      }
    }
    if (this.policy.budget && this.processes.size > this.options.budget) {
      throw new Error(`${this.processes.size} processes over a budget of ${this.options.budget}`)
    }
  }

  private result(endedAt: number): RunResult {
    const tasks = this.tasks.map((task): TaskOutcome => {
      const allowed = task.info.deadline - task.info.submittedAt
      const finished = task.finishedAt ?? endedAt
      const met = !task.rejected && !task.failed && task.finishedAt !== null && task.finishedAt <= task.info.deadline
      return {
        id: task.info.id,
        type: task.info.type,
        items: task.info.items,
        skewed: task.plan.skewed,
        submittedAt: task.info.submittedAt,
        deadline: task.info.deadline,
        finishedAt: task.finishedAt,
        rejected: task.rejected,
        failed: task.failed,
        met,
        lateness: task.rejected ? Number.NaN : (finished - task.info.submittedAt) / allowed,
        deadLettered: task.dead,
        done: task.done,
        workers: task.leases.length,
      }
    })
    return {
      scenario: this.workload.scenario.name,
      machine: this.machine.name,
      policy: this.policy.name,
      seed: this.options.seed,
      budget: this.options.budget,
      endedAt,
      tasks,
      cpu: { ...this.cpu },
      counts: { ...this.counts },
      peaks: { ...this.peaks },
      series: this.series,
    }
  }
}

export function workerMemoryMb(calibration: Calibration, items: number): number {
  const { baseRssMb, steadyRssMb, memoryRampItems } = calibration
  const share = Math.min(1, Math.log1p(items) / Math.log1p(memoryRampItems))
  return baseRssMb + (steadyRssMb - baseRssMb) * share
}

export function defaultBudget(calibration: Calibration, machine: MachineSpec): number {
  const curve = curveFor(calibration, machine.cores)
  const knee = Math.round((curve.knee * machine.cores) / curve.cpus)
  const byMemory = Math.floor((machine.memoryMb - machine.supervisorMb) / calibration.steadyRssMb)
  return Math.max(1, Math.min(knee, byMemory, machine.maxProcesses))
}
