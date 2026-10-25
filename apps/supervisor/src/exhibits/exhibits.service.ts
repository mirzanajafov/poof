import { randomUUID } from 'node:crypto'
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type BeforeApplicationShutdown,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  emptyExhibitStats,
  type ExhibitEnd,
  type ExhibitParams,
  type ExhibitSnapshot,
  type ExhibitStats,
} from '@poof/contracts'
import { exhibitPolicies, exhibitSchedule, expectedCostMs, serverCostModels, type Arrival } from '@poof/core'
import { within, type Context, type Span } from '@poof/tracing'
import type { Env } from '../config/env.js'
import { Datasets, type Dataset } from '../datasets/datasets.service.js'
import { Database, Events, Traces } from '../infra/infra.module.js'
import { Scheduler } from '../scheduler/scheduler.service.js'
import { LeaseEngine } from './lease-engine.js'

interface Current {
  id: string
  params: ExhibitParams
  dataset: Dataset
  engine: LeaseEngine | null
  pool: { submitted: number; rejected: number; tasks: string[]; stats: ExhibitStats }
  startedAt: number
  endsAt: number
  timers: NodeJS.Timeout[]
  arriving: Promise<void>
  finishing: Promise<ExhibitStats> | null
  span: Span
}

@Injectable()
export class Exhibits implements BeforeApplicationShutdown {
  private readonly logger = new Logger(Exhibits.name)
  private current: Current | null = null
  private readonly settings: Pick<
    Env,
    'BUDGET' | 'CAPACITY_CORES' | 'MAX_ATTEMPTS' | 'DEAD_LETTER_SHARE' | 'WORKER_RSS_MB' | 'EXHIBIT_MAX_PROCESSES'
  >

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
    const policy = exhibitPolicies[params.policy]
    let engine: LeaseEngine | null = null
    if (policy.engine === 'lease') {
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
      pool: { submitted: 0, rejected: 0, tasks: [], stats: emptyExhibitStats() },
      startedAt,
      endsAt,
      timers: [],
      arriving: Promise.resolve(),
      finishing: null,
      span,
    }
    this.current = current
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
      current.timers.push(
        setTimeout(() => this.schedule(current, () => this.arrive(current, arrival, itemMs)), arrival.at),
      )
    }
    current.timers.push(setTimeout(() => void this.finish('DONE'), params.durationSeconds * 1000))
    current.timers.push(setInterval(() => void this.publishState(current), 1000))
    void this.publishState(current)
    this.events.publish({ kind: 'exhibit.started', exhibit: id, policy: params.policy, endsAt })
    return { id, endsAt }
  }

  private async arrive(current: Current, arrival: Arrival, itemMs: number[]): Promise<void> {
    if (this.current !== current || current.finishing) return
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
      {
        dataset: dataset.name,
        preset: params.preset,
        deadlineSeconds: deadlineMs / 1000,
        count: arrival.count,
        offset: arrival.offset,
      },
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

  finish(status: ExhibitEnd): Promise<ExhibitStats | null> {
    const current = this.current
    if (!current) return Promise.resolve(null)
    current.finishing ??= this.end(current, status)
    return current.finishing
  }

  private async end(current: Current, status: ExhibitEnd): Promise<ExhibitStats> {
    for (const timer of current.timers) clearTimeout(timer)
    try {
      await current.arriving
      const stats = current.engine ? await current.engine.stop() : await this.finishPool(current)
      await this.db.client.exhibit.update({
        where: { id: current.id },
        data: { status, endedAt: new Date(), stats: { ...stats } },
      })
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
      this.events.publish({ kind: 'exhibit.ended', exhibit: current.id, status, stats })
      return stats
    } finally {
      if (current.engine) this.scheduler.resume()
      this.current = null
      this.events.clearExhibitSnapshot()
    }
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
    const stats = emptyExhibitStats()
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

  private async publishState(current: Current): Promise<void> {
    if (!current.engine) current.pool.stats = await this.poolCounts(current).catch(() => current.pool.stats)
    if (this.current === current && !current.finishing) this.events.saveExhibitSnapshot(this.snapshot(current))
  }

  state(): ExhibitSnapshot | null {
    return this.current ? this.snapshot(this.current) : null
  }

  private snapshot(current: Current): ExhibitSnapshot {
    const base = { id: current.id, params: current.params, startedAt: current.startedAt, endsAt: current.endsAt }
    if (current.engine) return { ...base, ...current.engine.snapshot() }
    return {
      ...base,
      budget: this.settings.BUDGET,
      processes: this.scheduler.health().workers,
      stats: current.pool.stats,
      tasks: [],
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.finish('ABORTED')
  }
}
