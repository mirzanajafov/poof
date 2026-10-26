import { randomUUID } from 'node:crypto'
import { Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common'
import {
  emptyExhibitStats,
  type ExhibitEnd,
  type ExhibitParams,
  type ExhibitSnapshot,
  type ExhibitStats,
} from '@poof/contracts'
import { exhibitPolicies, exhibitSchedule, predictedCostMs, type Arrival } from '@poof/core'
import { ConflictError, Database, FailureStreak, TracingService } from '@poof/nest'
import { within, type Context, type Span } from '@poof/tracing'
import { Env } from '../config/env.js'
import { Datasets, type Dataset } from '../datasets/datasets.service.js'
import { LivePublisher } from '../infra/live-publisher.js'
import { Scheduler } from '../scheduler/scheduler.service.js'
import { TaskStore } from '../tasks/task-store.js'
import { LeaseEngine } from './lease-engine.js'

interface RunningExhibit {
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
  private readonly poolReads = new FailureStreak(this.logger, 'counting the pool exhibit tasks')
  private current: RunningExhibit | null = null
  private starting: Promise<unknown> | null = null

  constructor(
    private readonly env: Env,
    private readonly db: Database,
    private readonly publisher: LivePublisher,
    private readonly datasets: Datasets,
    private readonly scheduler: Scheduler,
    private readonly store: TaskStore,
    private readonly tracing: TracingService,
  ) {}

  async start(params: ExhibitParams, trace?: Context): Promise<{ id: string; endsAt: number }> {
    if (this.current || this.starting) throw new ConflictError('an exhibit is already running')
    const starting = this.begin(params, trace)
    this.starting = starting
    try {
      return await starting
    } finally {
      this.starting = null
    }
  }

  private async begin(params: ExhibitParams, trace?: Context): Promise<{ id: string; endsAt: number }> {
    const dataset = await this.datasets.get(params.dataset)
    const id = randomUUID()
    const startedAt = Date.now()
    const endsAt = startedAt + params.durationSeconds * 1000
    await this.db.client.exhibit.create({ data: { id, policy: params.policy, params: { ...params } } })
    const span = this.tracing.tracer.startSpan(
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
          budget: this.env.BUDGET,
          maxProcesses: this.env.EXHIBIT_MAX_PROCESSES,
          capacityCores: this.env.CAPACITY_CORES,
          maxAttempts: this.env.MAX_ATTEMPTS,
          deadLetterShare: this.env.DEAD_LETTER_SHARE,
          rssMb: this.env.WORKER_RSS_MB,
          tickMs: 250,
          tracer: this.tracing.tracer,
          trace: within(span),
        },
        this.store,
        this.publisher,
        this.datasets,
      )
      engine.start()
    }
    const current: RunningExhibit = {
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
    const itemMs = dataset.items.map((item) => predictedCostMs(params.preset, item))
    const arrivals = exhibitSchedule(
      {
        durationMs: params.durationSeconds * 1000,
        utilization: params.utilization,
        capacityCores: this.env.CAPACITY_CORES,
        minItems: params.minItems,
        maxItems: params.maxItems,
        slackMin: params.slackMin,
        slackMax: params.slackMax,
        seed: params.seed,
      },
      itemMs,
    )
    for (const arrival of arrivals) {
      current.timers.push(setTimeout(() => this.schedule(current, () => this.arrive(current, arrival)), arrival.at))
    }
    current.timers.push(
      setTimeout(
        () =>
          void this.finish('DONE').catch((error: unknown) =>
            this.logger.error(`exhibit ${id} did not finish cleanly`, error),
          ),
        params.durationSeconds * 1000,
      ),
    )
    current.timers.push(setInterval(() => void this.publishState(current), 1000))
    this.publisher.saveExhibitSnapshot(this.snapshot(current))
    this.publisher.publish({ kind: 'exhibit.started', exhibit: id, policy: params.policy, endsAt })
    return { id, endsAt }
  }

  private async arrive(current: RunningExhibit, arrival: Arrival): Promise<void> {
    if (current.finishing) return
    const { params, dataset } = current
    const items = this.datasets.select(dataset, arrival.offset, arrival.count)
    const predictedMs = items.reduce((sum, item) => sum + predictedCostMs(params.preset, item), 0)
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

  private schedule(current: RunningExhibit, arrive: () => Promise<void>): void {
    current.arriving = current.arriving
      .then(arrive)
      .catch((error: unknown) => this.logger.error('an exhibit arrival failed', error))
  }

  finish(status: ExhibitEnd): Promise<ExhibitStats | null> {
    const current = this.current
    if (!current) return Promise.resolve(null)
    current.finishing ??= this.end(current, status)
    return current.finishing
  }

  private async end(current: RunningExhibit, status: ExhibitEnd): Promise<ExhibitStats> {
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
      this.publisher.publish({ kind: 'exhibit.ended', exhibit: current.id, status, stats })
      return stats
    } finally {
      if (current.engine) this.scheduler.resume()
      this.current = null
      this.publisher.clearExhibitSnapshot()
    }
  }

  private async finishPool(current: RunningExhibit): Promise<ExhibitStats> {
    const cancelled = this.scheduler.cancel(current.pool.tasks, 'exhibit ended')
    await this.store.flush()
    const stats = await this.poolCounts(current)
    stats.cancelled = cancelled
    return stats
  }

  private async poolCounts(current: RunningExhibit): Promise<ExhibitStats> {
    const tasks = await this.db.client.task.findMany({
      where: { exhibitId: current.id },
      select: { status: true, done: true, deadLettered: true, deadline: true, finishedAt: true },
    })
    const stats = emptyExhibitStats()
    stats.submitted = current.pool.submitted
    stats.rejected = current.pool.rejected
    stats.peakProcesses = this.env.BUDGET
    for (const task of tasks) {
      stats.items += task.done
      stats.deadLettered += task.deadLettered
      if (task.status !== 'DONE') continue
      stats.done++
      if (task.finishedAt && task.finishedAt <= task.deadline) stats.met++
    }
    return stats
  }

  private async publishState(current: RunningExhibit): Promise<void> {
    if (!current.engine) {
      try {
        current.pool.stats = await this.poolCounts(current)
        this.poolReads.succeeded()
      } catch (error) {
        this.poolReads.failed(error)
      }
    }
    if (!current.finishing) this.publisher.saveExhibitSnapshot(this.snapshot(current))
  }

  state(): ExhibitSnapshot | null {
    return this.current ? this.snapshot(this.current) : null
  }

  private snapshot(current: RunningExhibit): ExhibitSnapshot {
    const shared = { id: current.id, params: current.params, startedAt: current.startedAt, endsAt: current.endsAt }
    if (current.engine) return { ...shared, ...current.engine.snapshot() }
    return {
      ...shared,
      budget: this.env.BUDGET,
      processes: this.scheduler.health().workers,
      stats: current.pool.stats,
      tasks: [],
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.starting?.catch(() => undefined)
    await this.finish('ABORTED')
  }
}
