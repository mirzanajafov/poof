import { randomUUID } from 'node:crypto'
import { ConflictException, Injectable, Logger, NotFoundException, type BeforeApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { expectedCostMs, policies, Rng, serverCostModels, type PolicyConfig } from '@poof/core'
import type { PresetName } from '@poof/imaging'
import type { Env } from '../config/env.js'
import { Datasets } from '../datasets/datasets.service.js'
import { Database, Events } from '../infra/infra.module.js'
import { Scheduler } from '../scheduler/scheduler.service.js'
import { LeaseEngine, type ExhibitStats } from './lease-engine.js'

export const exhibitPolicies: Record<string, PolicyConfig> = Object.fromEntries(
  [
    policies.never,
    policies.static,
    policies.box,
    policies.timerManaged,
    policies.forecast,
    policies.forecastManaged,
    policies.forecastPreempt,
  ].map((p) => [p.name, p]),
)

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
  engine: LeaseEngine
  startedAt: number
  endsAt: number
  timers: NodeJS.Timeout[]
  arriving: Promise<void>
}

@Injectable()
export class Exhibits implements BeforeApplicationShutdown {
  private readonly logger = new Logger(Exhibits.name)
  private current: Current | null = null
  private readonly settings: Pick<Env, 'BUDGET' | 'CAPACITY_CORES' | 'MAX_ATTEMPTS' | 'DEAD_LETTER_SHARE' | 'WORKER_RSS_MB' | 'EXHIBIT_MAX_PROCESSES'>

  constructor(
    config: ConfigService<Env, true>,
    private readonly db: Database,
    private readonly events: Events,
    private readonly datasets: Datasets,
    private readonly scheduler: Scheduler,
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

  async start(params: ExhibitParams): Promise<{ id: string; endsAt: number }> {
    if (this.current) throw new ConflictException('an exhibit is already running')
    const policy = exhibitPolicies[params.policy]
    if (!policy) throw new NotFoundException(`no exhibit policy ${params.policy}`)
    const dataset = await this.datasets.get(params.dataset)
    const model = serverCostModels[params.preset]
    if (!model) throw new NotFoundException(`no cost model for ${params.preset}`)
    const id = randomUUID()
    const startedAt = Date.now()
    const endsAt = startedAt + params.durationSeconds * 1000
    await this.db.client.exhibit.create({ data: { id, policy: policy.name, params: { ...params } } })
    await this.scheduler.pause(endsAt + 15_000)
    const engine = new LeaseEngine(
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
      },
      this.db,
      this.events,
      this.datasets,
    )
    engine.start()
    const current: Current = { id, params, engine, startedAt, endsAt, timers: [], arriving: Promise.resolve() }
    this.current = current

    const rng = new Rng(params.seed)
    const itemMs = dataset.items.reduce((sum, item) => sum + expectedCostMs(model, (item.width * item.height) / 1e6), 0) / dataset.items.length
    const meanItems = (params.maxItems - params.minItems) / Math.log(params.maxItems / params.minItems) || params.minItems
    const rate = (params.utilization * this.settings.CAPACITY_CORES) / (meanItems * itemMs)
    const arrive = async () => {
      if (this.current !== current || Date.now() >= endsAt) return
      const count = Math.round(rng.logUniform(params.minItems, params.maxItems))
      const offset = rng.int(0, dataset.items.length - 1)
      const items = this.datasets.select(dataset, offset, count)
      const predictedMs = items.reduce((sum, item) => sum + expectedCostMs(model, (item.width * item.height) / 1e6), 0)
      const deadline = Date.now() + rng.logUniform(params.slackMin, params.slackMax) * predictedMs
      await engine.submit(dataset, items, params.preset, deadline, offset)
      if (this.current !== current) return
      current.timers.push(setTimeout(() => this.schedule(current, arrive), rng.exponential(rate)))
    }
    current.timers.push(setTimeout(() => this.schedule(current, arrive), 0))
    current.timers.push(setTimeout(() => void this.finish('DONE'), params.durationSeconds * 1000))
    current.timers.push(setInterval(() => this.events.snapshot('poof:exhibit', this.state()), 1000))
    this.events.publish('exhibit.started', { exhibit: id, policy: policy.name, endsAt })
    return { id, endsAt }
  }

  async finish(status: 'DONE' | 'ABORTED'): Promise<ExhibitStats | null> {
    const current = this.current
    if (!current) return null
    this.current = null
    for (const timer of current.timers) clearTimeout(timer)
    await current.arriving
    const stats = await current.engine.stop()
    await this.db.client.exhibit.update({
      where: { id: current.id },
      data: { status, endedAt: new Date(), stats: { ...stats } },
    })
    this.scheduler.resume()
    this.events.publish('exhibit.ended', { exhibit: current.id, status, stats })
    return stats
  }

  private schedule(current: Current, arrive: () => Promise<void>): void {
    current.arriving = arrive().catch((error: unknown) => this.logger.error(`exhibit arrival failed: ${String(error)}`))
  }

  state() {
    const current = this.current
    if (!current) return null
    return { id: current.id, params: current.params, startedAt: current.startedAt, endsAt: current.endsAt, ...current.engine.snapshot() }
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.finish('ABORTED')
  }
}
