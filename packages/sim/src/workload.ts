import { expectedCostMs, medianCostMs, type CostModel } from '@poof/core'
import { Rng } from './rng.ts'

export interface Window {
  from: number
  to: number
}

export interface Scenario {
  name: string
  arrivalsMs: number
  drainMs: number
  utilization: number
  types: ReadonlyArray<{ weight: number; value: string }>
  items: [number, number]
  slack: [number, number]
  burst?: Window & { utilization: number }
  neighbour?: Window & { capacity: number }
  skew?: { share: number; block: [number, number]; factor: [number, number] }
  poison?: { share: number; items: [number, number]; outage?: Window & { type: string } }
}

export interface TaskPlan {
  index: number
  id: string
  type: string
  profile: string
  submittedAt: number
  deadline: number
  costs: Float64Array
  mp: Float32Array
  poison: Uint8Array
  skewed: boolean
}

type MpSampler = (rng: Rng) => number

export interface Profile {
  name: string
  mp: MpSampler
}

const web: MpSampler = (rng) => rng.logUniform(0.3, 2)
const phone: MpSampler = (rng) => rng.uniform(8, 16)
const camera: MpSampler = (rng) => rng.uniform(20, 30)
const huge: MpSampler = (rng) => rng.uniform(40, 60)
const mixed: MpSampler = (rng) =>
  rng.weighted([
    { weight: 30, value: web },
    { weight: 45, value: phone },
    { weight: 20, value: camera },
    { weight: 5, value: huge },
  ])(rng)

export const profiles: ReadonlyArray<{ weight: number; value: Profile }> = [
  { weight: 25, value: { name: 'web', mp: web } },
  { weight: 45, value: { name: 'phone', mp: phone } },
  { weight: 20, value: { name: 'camera', mp: camera } },
  { weight: 10, value: { name: 'mixed', mp: mixed } },
]

export function itemCost(cost: CostModel, mp: number, rng: Rng): number {
  return Math.max(1, medianCostMs(cost, mp) * Math.exp(cost.logResidualSd * rng.normal()))
}

const profileCosts = new Map<string, number>()

export function expectedItemCost(cost: CostModel, profile: Profile): number {
  const key = `${cost.coefMs}|${cost.exponent}|${cost.logResidualSd}|${profile.name}`
  let value = profileCosts.get(key)
  if (value === undefined) {
    const rng = Rng.of('profile-cost', profile.name)
    let sum = 0
    const samples = 20_000
    for (let i = 0; i < samples; i++) sum += expectedCostMs(cost, profile.mp(rng))
    value = sum / samples
    profileCosts.set(key, value)
  }
  return value
}

export interface WorkloadStats {
  meanTaskWorkMs: number
  meanItems: number
}

export function workloadStats(scenario: Scenario, types: Record<string, CostModel>): WorkloadStats {
  const rng = Rng.of('stats', scenario.name)
  const [lo, hi] = scenario.items
  const meanItems = (hi - lo) / Math.log(hi / lo)
  let cost = 0
  const samples = 20_000
  for (let i = 0; i < samples; i++) {
    const type = types[rng.weighted(scenario.types)]!
    cost += expectedCostMs(type, rng.weighted(profiles).mp(rng))
  }
  return { meanTaskWorkMs: (cost / samples) * meanItems, meanItems }
}

export function inWindow(window: Window | undefined, now: number): boolean {
  return window !== undefined && now >= window.from && now < window.to
}

export class Workload {
  readonly scenario: Scenario
  readonly types: Record<string, CostModel>
  readonly stats: WorkloadStats
  private readonly seed: number
  private readonly baseRate: number
  private readonly burstRate: number
  private readonly arrivalRng: Rng
  private clock = 0
  private count = 0

  constructor(scenario: Scenario, types: Record<string, CostModel>, cores: number, seed: number) {
    this.scenario = scenario
    this.types = types
    this.seed = seed
    this.stats = workloadStats(scenario, types)
    const capacityMsPerMs = cores
    this.baseRate = (scenario.utilization * capacityMsPerMs) / this.stats.meanTaskWorkMs
    this.burstRate = scenario.burst ? (scenario.burst.utilization * capacityMsPerMs) / this.stats.meanTaskWorkMs : this.baseRate
    this.arrivalRng = Rng.of(seed, scenario.name, 'arrivals')
  }

  rateAt(now: number): number {
    return inWindow(this.scenario.burst, now) ? this.burstRate : this.baseRate
  }

  nextArrival(): number | null {
    const peak = Math.max(this.baseRate, this.burstRate)
    while (true) {
      this.clock += this.arrivalRng.exponential(peak)
      if (this.clock >= this.scenario.arrivalsMs) return null
      if (this.arrivalRng.next() * peak <= this.rateAt(this.clock)) return this.clock
    }
  }

  task(submittedAt: number): TaskPlan {
    const index = this.count++
    const rng = Rng.of(this.seed, this.scenario.name, 'task', index)
    const s = this.scenario
    const typeName = rng.weighted(s.types)
    const type = this.types[typeName]!
    const profile = rng.weighted(profiles)
    const items = Math.round(rng.logUniform(s.items[0], s.items[1]))
    const slack = rng.logUniform(s.slack[0], s.slack[1])
    const costs = new Float64Array(items)
    const mps = new Float32Array(items)
    const poison = new Uint8Array(items)
    for (let i = 0; i < items; i++) {
      mps[i] = profile.mp(rng)
      costs[i] = itemCost(type, mps[i]!, rng)
    }
    let skewed = false
    if (s.skew && rng.next() < s.skew.share) {
      skewed = true
      const length = Math.max(1, Math.round(items * rng.uniform(s.skew.block[0], s.skew.block[1])))
      const start = rng.int(0, items - length)
      const factor = rng.uniform(s.skew.factor[0], s.skew.factor[1])
      for (let i = start; i < start + length; i++) costs[i] = costs[i]! * factor
    }
    if (s.poison && rng.next() < s.poison.share) {
      const count = rng.int(s.poison.items[0], s.poison.items[1])
      for (let i = 0; i < count; i++) poison[rng.int(0, items - 1)] = 1
    }
    const deadline = submittedAt + slack * items * expectedItemCost(type, profile)
    return {
      index,
      id: `t${index}`,
      type: typeName,
      profile: profile.name,
      submittedAt,
      deadline,
      costs,
      mp: mps,
      poison,
      skewed,
    }
  }
}
