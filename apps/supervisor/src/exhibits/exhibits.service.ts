import { randomUUID } from 'node:crypto'
import { ConflictException, Injectable, Logger, NotFoundException, type BeforeApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { exhibitSchedule, expectedCostMs, policies, serverCostModels, type Arrival, type PolicyConfig } from '@poof/core'
import type { PresetName } from '@poof/imaging'
import { within, type Context, type Span } from '@poof/tracing'
import type { Env } from '../config/env.js'
import { Datasets, type Dataset } from '../datasets/datasets.service.js'
import { Database, Events, Traces } from '../infra/infra.module.js'
import { Scheduler } from '../scheduler/scheduler.service.js'
import { LeaseEngine, type ExhibitStats } from './lease-engine.js'

export const exhibitPolicies: Record<string, PolicyConfig | null> = {
  pool: null,
  ...Object.fromEntries(
    [
      policies.never,
      policies.static,
      policies.box,
      policies.timerManaged,
      policies.forecast,
      policies.forecastManaged,
      policies.forecastPreempt,
    ].map((p) => [p.name, p]),
  ),
}

export interface ExhibitParams {
  policy: string
  durationSeconds: number
  utilization: number
  dataset: string
  preset: PresetName
  minItems: number
  maxItems: number
  slackMin: number
  slackMax: number
  seed: number
}

interface Current {
  id: string
  params: ExhibitParams
  dataset: Dataset
  engine: LeaseEngine | null
  pool: { submitted: number; rejected: number; tasks: string[] }
  startedAt: number
  endsAt: number
  timers: NodeJS.Timeout[]
  arriving: Promise<void>
  span: Span
}

const emptyStats = (): ExhibitStats => ({
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
})

@Injectable()
export class Exhibits implements BeforeApplicationShutdown {
  private readonly logger = new Logger(Exhibits.name)
  private current: Current | null = null
  private poolStats: ExhibitStats = emptyStats()
  private readonly settings: Pick<Env, 'BUDGET' | 'CAPACITY_CORES' | 'MAX_ATTEMPTS' | 'DEAD_LETTER_SHARE' | 'WORKER_RSS_MB' | 'EXHIBIT_MAX_PROCESSES'>

  constructor(
    config: ConfigService<Env, true>,
    private readonly db: Database,
    private readonly events: Events,
    private readonly datasets: Datasets,
    private readonly scheduler: Scheduler,
    private readonly traces: Traces,
  ) {
    this.settings = {
      BUDGET: config.get('BUDGET', { infer: true }),
      CAPACITY_CORES: config.get('CAPACITY_CORES', { infer: true }),
      MAX_ATTEMPTS: config.get('MAX_ATTEMPTS', { infer: true }),
      DEAD_LETTER_SHARE: config.get('DEAD_LETTER_SHARE', { infer: true }),
      WORKER_RSS_MB: config.get('WORKER_RSS_MB', { infer: true }),
      EXHIBIT_MAX_PROCESSES: config.get('EXHIBIT_MAX_PROCESSES', { infer: true }),
    }
  }

  async start(params: ExhibitParams, trace?: Context): Promise<{ id: string; endsAt: number }> {
    if (this.current) throw new ConflictException('an exhibit is already running')
    if (!(params.policy in exhibitPolicies)) throw new NotFoundException(`no exhibit policy ${params.policy}`)
    const policy = exhibitPolicies[params.policy] ?? null
    const dataset = await this.datasets.get(params.dataset)
    const model = serverCostModels[params.preset]
    if (!model) throw new NotFoundException(`no cost model for ${params.preset}`)
    const id = randomUUID()
    const startedAt = Date.now()
    const endsAt = startedAt + params.durationSeconds * 1000
    await this.db.client.exhibit.create({ data: { id, policy: params.policy, params: { ...params } } })
    const span = this.traces.tracer.startSpan(
      'exhibit',
      {
        startTime: startedAt,
        attributes: {
          'poof.exhibit': id,
          'poof.policy': params.policy,
          'poof.seed': params.seed,
          'poof.duration_s': params.durationSeconds,
          'poof.utilization': params.utilization,
          'poof.dataset': params.dataset,
        },
      },
      trace,
    )
    let engine: LeaseEngine | null = null
    if (policy) {
      await this.scheduler.pause(endsAt + 15_000)
      engine = new LeaseEngine(
        {
          exhibitId: id,
          policy,
          budget: this.settings.BUDGET,
          maxProcesses: this.settings.EXHIBIT_MAX_PROCESSES,
          capacityCores: this.settings.CAPACITY_CORES,
          maxAttempts: this.settings.MAX_ATTEMPTS,
          deadLetterShare: this.settings.DEAD_LETTER_SHARE,
          rssMb: this.settings.WORKER_RSS_MB,
          tickMs: 250,
          tracer: this.traces.tracer,
          trace: within(span),
        },
        this.db,
        this.events,
        this.datasets,
      )
      engine.start()
    }
    const current: Current = {
      id,
      params,
      dataset,
      engine,
      pool: { submitted: 0, rejected: 0, tasks: [] },
      startedAt,
      endsAt,
      timers: [],
      arriving: Promise.resolve(),
      span,
    }
    this.current = current
    this.poolStats = emptyStats()
    const itemMs = dataset.items.map((item) => expectedCostMs(model, (item.width * item.height) / 1e6))
    const arrivals = exhibitSchedule(
      {
        durationMs: params.durationSeconds * 1000,
        utilization: params.utilization,
        capacityCores: this.settings.CAPACITY_CORES,
        minItems: params.minItems,
        maxItems: params.maxItems,
        slackMin: params.slackMin,
        slackMax: params.slackMax,
        seed: params.seed,
      },
      itemMs,
    )
    for (const arrival of arrivals) {
      current.timers.push(setTimeout(() => this.schedule(current, () => this.arrive(current, arrival, itemMs)), arrival.at))
    }
    current.timers.push(setTimeout(() => void this.finish('DONE'), params.durationSeconds * 1000))
    current.timers.push(setInterval(() => void this.publishState(), 1000))
    this.events.publish('exhibit.started', { exhibit: id, policy: params.policy, endsAt })
    return { id, endsAt }
  }

  private async arrive(current: Current, arrival: Arrival, itemMs: number[]): Promise<void> {
    if (this.current !== current) return
    const { params, dataset } = current
    const items = this.datasets.select(dataset, arrival.offset, arrival.count)
    let predictedMs = 0
    for (let i = 0; i < arrival.count; i++) predictedMs += itemMs[(arrival.offset + i) % itemMs.length]!
    const deadlineMs = arrival.slack * predictedMs
    if (current.engine) {
      await current.engine.submit(dataset, items, params.preset, Date.now() + deadlineMs, arrival.offset)
      return
    }
    const result = await this.scheduler.submit(
      { dataset: dataset.name, preset: params.preset, deadlineSeconds: deadlineMs / 1000, count: arrival.count, offset: arrival.offset },
      { exhibitId: current.id, trace: within(current.span) },
    )
    current.pool.submitted++
    if (result.accepted) current.pool.tasks.push(result.id)
    else current.pool.rejected++
  }

  private schedule(current: Current, arrive: () => Promise<void>): void {
    current.arriving = current.arriving
      .then(arrive)
      .catch((error: unknown) => this.logger.error(`exhibit arrival failed: ${String(error)}`))
  }

  async finish(status: 'DONE' | 'ABORTED'): Promise<ExhibitStats | null> {
    const current = this.current
    if (!current) return null
    this.current = null
    for (const timer of current.timers) clearTimeout(timer)
    await current.arriving
    const stats = current.engine ? await current.engine.stop() : await this.finishPool(current)
    await this.db.client.exhibit.update({
      where: { id: current.id },
      data: { status, endedAt: new Date(), stats: { ...stats } },
    })
    if (current.engine) this.scheduler.resume()
    current.span.setAttributes({
      'poof.status': status,
      'poof.submitted': stats.submitted,
      'poof.rejected': stats.rejected,
      'poof.met': stats.met,
      'poof.spawns': stats.spawns,
      'poof.splits': stats.splits,
      'poof.peak_processes': stats.peakProcesses,
    })
    current.span.end()
    this.events.publish('exhibit.ended', { exhibit: current.id, status, stats })
    return stats
  }

  private async finishPool(current: Current): Promise<ExhibitStats> {
    const cancelled = this.scheduler.cancel(current.pool.tasks, 'exhibit ended')
    await this.scheduler.flush()
    const stats = await this.poolCounts(current)
    stats.cancelled = cancelled
    return stats
  }

  private async poolCounts(current: Current): Promise<ExhibitStats> {
    const tasks = await this.db.client.task.findMany({
      where: { exhibitId: current.id },
      select: { status: true, done: true, deadLettered: true, deadline: true, finishedAt: true },
    })
    const stats = emptyStats()
    stats.submitted = current.pool.submitted
    stats.rejected = current.pool.rejected
    stats.peakProcesses = this.settings.BUDGET
    for (const task of tasks) {
      stats.items += task.done
      stats.deadLettered += task.deadLettered
      if (task.status !== 'DONE') continue
      stats.done++
      if (task.finishedAt && task.finishedAt <= task.deadline) stats.met++
    }
    return stats
  }

  private async publishState(): Promise<void> {
    const current = this.current
    if (!current) return
    if (!current.engine) this.poolStats = await this.poolCounts(current).catch(() => this.poolStats)
    this.events.snapshot('poof:exhibit', this.state())
  }

  state() {
    const current = this.current
    if (!current) return null
    const base = { id: current.id, params: current.params, startedAt: current.startedAt, endsAt: current.endsAt }
    if (current.engine) return { ...base, ...current.engine.snapshot() }
    return {
      ...base,
      policy: 'pool',
      budget: this.settings.BUDGET,
      processes: this.scheduler.health().workers,
      stats: this.poolStats,
      tasks: [],
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.finish('ABORTED')
  }
}
