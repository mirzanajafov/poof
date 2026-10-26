import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { highlight, hitRateChart, smoothed, timelineChart } from './charts.ts'
import type { Sample } from './engine.ts'
import type { Cell } from './report.ts'
import { mainPolicies, scenarios } from './scenarios.ts'

const { values } = parseArgs({
  options: {
    label: { type: 'string', default: 'dev-linux' },
    machine: { type: 'string', default: 'cage' },
    dir: { type: 'string' },
  },
})
const dir = values.dir ?? fileURLToPath(new URL(`../results/${values.label}/`, import.meta.url))
const summary = JSON.parse(await readFile(join(dir, 'summary.json'), 'utf8')) as { cells: Cell[] }
const series = JSON.parse(await readFile(join(dir, 'raw', 'series.json'), 'utf8')) as Array<{
  machine: string
  scenario: string
  policy: string
  samples: Sample[]
}>
const machine = values.machine
const policies = mainPolicies.map((policy) => policy.name)
await writeFile(
  join(dir, `hit-rate-${machine}.svg`),
  hitRateChart(summary.cells, machine, policies, `Deadline hit rate by policy (${machine})`),
)
const burst = scenarios.burst?.burst
if (!burst) throw new Error('the burst scenario has no burst window')
const picks: Array<[string, string]> = [
  ['forecast+budget', 's1'],
  ['box', 's2'],
  ['pool-10', 's3'],
  ['forecast+preempt', 's4'],
]
const lines = picks
  .map(([policy, cls]) => ({
    policy,
    cls,
    samples: series.find((s) => s.machine === machine && s.scenario === 'burst' && s.policy === policy)?.samples ?? [],
  }))
  .filter((l) => l.samples.length > 0)
const budget = summary.cells.find((c) => c.machine === machine && c.policy === highlight)?.budget ?? 0
const window = {
  from: burst.from - 5 * 60_000,
  to: burst.to + 15 * 60_000,
  event: { ...burst, label: 'burst: arrivals at 1.5× capacity' },
}
await writeFile(
  join(dir, `burst-processes-${machine}.svg`),
  timelineChart(lines, (s) => s.processes, {
    ...window,
    title: `Live worker processes during a burst (${machine}, seed 1)`,
    subtitle: 'Processes alive each second, including ones still starting.',
    reference: { value: budget, label: `budget ${budget}` },
    format: (v) => v.toFixed(0),
  }),
)
await writeFile(
  join(dir, `burst-goodput-${machine}.svg`),
  timelineChart(smoothed(lines, 15), (s) => s.goodput, {
    ...window,
    title: `Goodput during a burst (${machine}, seed 1)`,
    subtitle:
      'Useful image work finished, as a share of the cores, 15 s rolling mean. Spawns, killed work and retries do not count.',
    format: (v) => `${Math.round(v * 100)}%`,
  }),
)
console.log(`wrote charts to ${dir}`)
