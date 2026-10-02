import type { RunMetrics } from './metrics.ts'
import { bootstrap, mean, quantile, type Interval } from './stats.ts'

export interface Cell {
  machine: string
  scenario: string
  policy: string
  seeds: number
  budget: number
  tasks: number
  hitRate: Interval
  rejectionRate: number
  failedRate: number
  unfinishedRate: number
  skewedHitRate: Interval | null
  otherTypeHitRate: Interval | null
  lateness: { p50: number; p95: number; p99: number }
  cpuPerItemMs: number
  overheadShare: number
  spawnsPerTask: number
  splitsPerTask: number
  claimsPerTask: number
  peakProcesses: { mean: number; max: number }
  maxDepth: number
  oomKills: number
  crashes: number
  spawnFailures: number
  deadLettered: number
  breakerOpened: number
  eventGoodput: Interval | null
  eventPeakProcesses: number | null
  recovery: { meanMs: number; unrecovered: number } | null
}

export interface Comparison {
  machine: string
  scenario: string
  metric: string
  a: string
  b: string
  difference: Interval
}

function key(m: Pick<RunMetrics, 'machine' | 'scenario' | 'policy'>): string {
  return `${m.machine}|${m.scenario}|${m.policy}`
}

function present(values: Array<number | null>): number[] {
  return values.filter((v): v is number => v !== null && Number.isFinite(v))
}

export function summarize(metrics: readonly RunMetrics[]): Cell[] {
  const groups = new Map<string, RunMetrics[]>()
  for (const m of metrics) groups.set(key(m), [...(groups.get(key(m)) ?? []), m])
  return [...groups.values()].map((runs) => {
    const first = runs[0]!
    const lateness = runs.flatMap((r) => r.lateness).filter(Number.isFinite)
    const skewed = present(runs.map((r) => r.skewedHitRate))
    const others = present(runs.map((r) => r.otherTypeHitRate))
    const goodput = present(runs.map((r) => r.eventGoodput))
    const recoveries = runs.map((r) => r.recoveryMs)
    const hasRecovery = runs.some((r) => r.recoveryMs !== null) || first.scenario === 'burst'
    const eventPeaks = present(runs.map((r) => r.eventPeakProcesses))
    return {
      machine: first.machine,
      scenario: first.scenario,
      policy: first.policy,
      seeds: runs.length,
      budget: first.budget,
      tasks: runs.reduce((sum, r) => sum + r.submitted, 0),
      hitRate: bootstrap(runs.map((r) => r.hitRate)),
      rejectionRate: mean(runs.map((r) => r.rejectionRate)),
      failedRate: mean(runs.map((r) => r.failedRate)),
      unfinishedRate: mean(runs.map((r) => r.unfinishedRate)),
      skewedHitRate: skewed.length ? bootstrap(skewed) : null,
      otherTypeHitRate: others.length ? bootstrap(others) : null,
      lateness: { p50: quantile(lateness, 0.5), p95: quantile(lateness, 0.95), p99: quantile(lateness, 0.99) },
      cpuPerItemMs: mean(runs.map((r) => r.cpuPerItemMs)),
      overheadShare: mean(runs.map((r) => r.overheadShare)),
      spawnsPerTask: mean(runs.map((r) => r.spawnsPerTask)),
      splitsPerTask: mean(runs.map((r) => r.splitsPerTask)),
      claimsPerTask: mean(runs.map((r) => r.claimsPerTask)),
      peakProcesses: { mean: mean(runs.map((r) => r.peakProcesses)), max: Math.max(...runs.map((r) => r.peakProcesses)) },
      maxDepth: Math.max(...runs.map((r) => r.maxDepth)),
      oomKills: mean(runs.map((r) => r.oomKills)),
      crashes: mean(runs.map((r) => r.crashes)),
      spawnFailures: mean(runs.map((r) => r.spawnFailures)),
      deadLettered: mean(runs.map((r) => r.deadLettered)),
      breakerOpened: mean(runs.map((r) => r.breakerOpened)),
      eventGoodput: goodput.length ? bootstrap(goodput) : null,
      eventPeakProcesses: eventPeaks.length ? mean(eventPeaks) : null,
      recovery: hasRecovery
        ? { meanMs: mean(present(recoveries)), unrecovered: recoveries.filter((r) => r === null).length }
        : null,
    }
  })
}

export function compare(
  metrics: readonly RunMetrics[],
  machine: string,
  scenario: string,
  a: string,
  b: string,
  metric: 'hitRate' | 'skewedHitRate' | 'cpuPerItemMs' | 'otherTypeHitRate' = 'hitRate',
): Comparison | null {
  const pick = (policy: string) =>
    new Map(
      metrics
        .filter((m) => m.machine === machine && m.scenario === scenario && m.policy === policy)
        .map((m) => [m.seed, m[metric]]),
    )
  const left = pick(a)
  const right = pick(b)
  const differences: number[] = []
  for (const [seed, value] of left) {
    const other = right.get(seed)
    if (value !== null && value !== undefined && other !== null && other !== undefined) differences.push(value - other)
  }
  if (differences.length === 0) return null
  return { machine, scenario, metric, a, b, difference: bootstrap(differences) }
}

function pct(value: number | undefined | null): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '-' : `${(value * 100).toFixed(1)}%`
}

function num(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '-' : value.toFixed(digits)
}

export function table(cells: readonly Cell[]): string {
  const lines: string[] = []
  const header = ['policy', 'hit', '95% CI', 'rej', 'skew hit', 'late p95', 'cpu/item', 'ovh', 'spawn/t', 'peak', 'oom', 'goodput', 'recov s']
  const groups = new Map<string, Cell[]>()
  for (const cell of cells) groups.set(`${cell.machine} ${cell.scenario}`, [...(groups.get(`${cell.machine} ${cell.scenario}`) ?? []), cell])
  for (const [name, group] of groups) {
    lines.push(`\n${name} (budget ${group[0]!.budget}, ${group[0]!.tasks} tasks over ${group[0]!.seeds} seeds)`)
    lines.push(header.join('\t'))
    for (const c of group) {
      lines.push(
        [
          c.policy.padEnd(18),
          pct(c.hitRate.mean),
          `${pct(c.hitRate.lo)}-${pct(c.hitRate.hi)}`,
          pct(c.rejectionRate),
          pct(c.skewedHitRate?.mean),
          num(c.lateness.p95, 2),
          num(c.cpuPerItemMs, 0),
          pct(c.overheadShare),
          num(c.spawnsPerTask),
          `${num(c.peakProcesses.mean, 0)}/${c.peakProcesses.max}`,
          num(c.oomKills),
          pct(c.eventGoodput?.mean),
          c.recovery ? `${num(c.recovery.meanMs / 1000, 0)} (${c.recovery.unrecovered} no)` : '-',
        ].join('\t'),
      )
    }
  }
  return lines.join('\n')
}
