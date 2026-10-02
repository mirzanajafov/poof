import type { RunResult, Sample } from './engine.ts'
import { mean } from './stats.ts'
import type { Scenario, Window } from './workload.ts'

export interface RunMetrics {
  scenario: string
  machine: string
  policy: string
  seed: number
  budget: number
  submitted: number
  hitRate: number
  rejectionRate: number
  failedRate: number
  unfinishedRate: number
  skewedHitRate: number | null
  otherTypeHitRate: number | null
  lateness: number[]
  cpuPerItemMs: number
  overheadShare: number
  spawnsPerTask: number
  splitsPerTask: number
  claimsPerTask: number
  peakProcesses: number
  maxDepth: number
  oomKills: number
  crashes: number
  spawnFailures: number
  deadLettered: number
  breakerOpened: number
  eventGoodput: number | null
  eventPeakProcesses: number | null
  recoveryMs: number | null
}

function within(series: Sample[], window: Window): Sample[] {
  return series.filter((s) => s.t >= window.from && s.t < window.to)
}

function recovery(series: Sample[], window: Window): number | null {
  const before = within(series, { from: window.from - 5 * 60_000, to: window.from })
  const baseline = mean(before.map((s) => s.backlogMs))
  const after = series.filter((s) => s.t >= window.to)
  const peak = Math.max(baseline, ...within(series, window).map((s) => s.backlogMs), ...after.slice(0, 1).map((s) => s.backlogMs))
  const target = baseline + 0.1 * (peak - baseline)
  const back = after.find((s) => s.backlogMs <= target)
  return back ? back.t - window.to : null
}

function rate(count: number, total: number): number {
  return total === 0 ? Number.NaN : count / total
}

export function derive(result: RunResult, scenario: Scenario): RunMetrics {
  const tasks = result.tasks
  const submitted = tasks.length
  const done = result.cpu.usefulMs
  const itemsDone = tasks.reduce((sum, t) => sum + (t.rejected ? 0 : t.items - t.deadLettered), 0)
  const total = result.cpu.usefulMs + result.cpu.spawnMs + result.cpu.lostMs
  const skewed = tasks.filter((t) => t.skewed)
  const outageType = scenario.poison?.outage?.type
  const others = outageType ? tasks.filter((t) => t.type !== outageType) : []
  const event = scenario.burst ?? scenario.neighbour ?? scenario.poison?.outage
  const eventSamples = event ? within(result.series, event) : []
  return {
    scenario: result.scenario,
    machine: result.machine,
    policy: result.policy,
    seed: result.seed,
    budget: result.budget,
    submitted,
    hitRate: rate(tasks.filter((t) => t.met).length, submitted),
    rejectionRate: rate(tasks.filter((t) => t.rejected).length, submitted),
    failedRate: rate(tasks.filter((t) => t.failed).length, submitted),
    unfinishedRate: rate(tasks.filter((t) => !t.rejected && t.finishedAt === null).length, submitted),
    skewedHitRate: skewed.length ? rate(skewed.filter((t) => t.met).length, skewed.length) : null,
    otherTypeHitRate: others.length ? rate(others.filter((t) => t.met).length, others.length) : null,
    lateness: tasks.filter((t) => !t.rejected).map((t) => t.lateness),
    cpuPerItemMs: itemsDone ? total / itemsDone : Number.NaN,
    overheadShare: done ? (total - done) / total : Number.NaN,
    spawnsPerTask: rate(result.counts.spawns, submitted),
    splitsPerTask: rate(result.counts.splits, submitted),
    claimsPerTask: rate(result.counts.claims, submitted),
    peakProcesses: result.peaks.processes,
    maxDepth: result.peaks.depth,
    oomKills: result.counts.oomKills,
    crashes: result.counts.crashes,
    spawnFailures: result.counts.spawnFailures,
    deadLettered: result.counts.deadLettered,
    breakerOpened: result.counts.breakerOpened,
    eventGoodput: eventSamples.length ? mean(eventSamples.map((s) => s.goodput)) : null,
    eventPeakProcesses: eventSamples.length ? Math.max(...eventSamples.map((s) => s.processes)) : null,
    recoveryMs: event && scenario.burst ? recovery(result.series, event) : null,
  }
}
