import { exhibitSchedule, expectedCostMs, policies, serverCostModels, type Arrival, type PolicyConfig, type TimeoutRule } from '@poof/core'
import type { Calibration } from './calibration.ts'
import { Simulation, type MachineSpec, type RunResult } from './engine.ts'
import type { Arrivals, Scenario, TaskPlan } from './workload.ts'

export interface ReplayItem {
  file: string
  mp: number
  costMs: number
  predictedMs: number
}

export interface ExhibitParams {
  durationSeconds: number
  utilization: number
  minItems: number
  maxItems: number
  slackMin: number
  slackMax: number
  seed: number
  dataset: string
  preset: string
}

export interface RealStats {
  submitted: number
  rejected: number
  done: number
  met: number
  cancelled: number
  items: number
  spawns: number
  splits: number
  peakProcesses: number
  exits: Record<string, number>
}

export interface ExhibitRun {
  id: string
  policy: string
  params: ExhibitParams
  stats: RealStats
}

export const replayMachine: MachineSpec = { name: 'cage', cores: 1.5, memoryMb: 1536, supervisorMb: 200, maxProcesses: 35 }

export const capacityCores = 1.32

export function replayPolicy(name: string): PolicyConfig {
  if (name === 'pool') return policies.pool
  const policy = Object.values(policies).find((p) => p.name === name)
  if (!policy) throw new Error(`no simulator policy for ${name}`)
  return policy
}

export function replayItems(
  manifest: Array<{ file: string; width: number; height: number }>,
  measured: ReadonlyMap<string, number>,
  preset: string,
): ReplayItem[] {
  const model = serverCostModels[preset]!
  return manifest.map((item) => {
    const mp = (item.width * item.height) / 1e6
    const costMs = measured.get(item.file)
    if (costMs === undefined) throw new Error(`no measured cost for ${item.file}`)
    return { file: item.file, mp, costMs, predictedMs: expectedCostMs(model, mp) }
  })
}

export class ReplayArrivals implements Arrivals {
  readonly scenario: Scenario
  private readonly arrivals: Arrival[]
  private readonly items: ReplayItem[]
  private next = 0
  private current = -1

  constructor(params: ExhibitParams, items: ReplayItem[]) {
    this.items = items
    this.scenario = {
      name: 'replay',
      arrivalsMs: params.durationSeconds * 1000,
      drainMs: 0,
      utilization: params.utilization,
      types: [{ weight: 1, value: params.preset }],
      items: [params.minItems, params.maxItems],
      slack: [params.slackMin, params.slackMax],
    }
    this.arrivals = exhibitSchedule(
      {
        durationMs: params.durationSeconds * 1000,
        utilization: params.utilization,
        capacityCores,
        minItems: params.minItems,
        maxItems: params.maxItems,
        slackMin: params.slackMin,
        slackMax: params.slackMax,
        seed: params.seed,
      },
      items.map((i) => i.predictedMs),
    )
  }

  nextArrival(): number | null {
    if (this.next >= this.arrivals.length) return null
    this.current = this.next++
    return this.arrivals[this.current]!.at
  }

  task(submittedAt: number): TaskPlan {
    const arrival = this.arrivals[this.current]!
    const costs = new Float64Array(arrival.count)
    const mp = new Float32Array(arrival.count)
    let predictedMs = 0
    for (let i = 0; i < arrival.count; i++) {
      const item = this.items[(arrival.offset + i) % this.items.length]!
      costs[i] = item.costMs
      mp[i] = item.mp
      predictedMs += item.predictedMs
    }
    return {
      index: this.current,
      id: `r${this.current}`,
      type: this.scenario.types[0]!.value,
      profile: 'dataset',
      submittedAt,
      deadline: submittedAt + arrival.slack * predictedMs,
      costs,
      mp,
      poison: new Uint8Array(arrival.count),
      skewed: false,
    }
  }
}

export function replay(run: ExhibitRun, items: ReplayItem[], calibration: Calibration, timeoutRule?: TimeoutRule): RunResult {
  return new Simulation({
    scenario: new ReplayArrivals(run.params, items).scenario,
    arrivals: new ReplayArrivals(run.params, items),
    machine: replayMachine,
    policy: replayPolicy(run.policy),
    calibration,
    seed: run.params.seed,
    budget: 2,
    itemTimeouts: true,
    warmPool: true,
    ...(timeoutRule ? { timeoutRule } : {}),
  }).run()
}
