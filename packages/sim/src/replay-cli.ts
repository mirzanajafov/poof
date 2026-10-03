import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { defaultResultsDir, loadCalibration } from './calibration.ts'
import type { RunResult } from './engine.ts'
import { replay, replayItems, type ExhibitRun } from './replay.ts'
import { mean, quantile } from './stats.ts'

const { values } = parseArgs({
  options: {
    runs: { type: 'string' },
    calibration: { type: 'string', default: 'server' },
    manifest: { type: 'string' },
    'steady-rss': { type: 'string' },
    'base-anon': { type: 'string' },
    out: { type: 'string' },
  },
})

interface Numbers {
  submitted: number
  rejected: number
  met: number
  peakProcesses: number
  spawns: number
  timeouts: number
  items: number
}

const calibration = loadCalibration(values.calibration!)
if (values['steady-rss']) calibration.steadyRssMb = Number(values['steady-rss'])
if (values['base-anon']) calibration.baseRssMb = Number(values['base-anon'])
const b1 = JSON.parse(readFileSync(join(defaultResultsDir, values.calibration!, 'b1-item-cost.json'), 'utf8')) as {
  samples: Array<{ source: string; preset: string; file: string; wallMs: number }>
}
const runs = JSON.parse(readFileSync(values.runs!, 'utf8')) as ExhibitRun[]
const manifest = (JSON.parse(readFileSync(values.manifest!, 'utf8')) as { items: Array<{ file: string; width: number; height: number }> }).items

function measured(preset: string): Map<string, number> {
  const walls = new Map<string, number[]>()
  for (const s of b1.samples) {
    if (s.preset !== preset || s.source !== 'synthetic') continue
    walls.set(s.file, [...(walls.get(s.file) ?? []), s.wallMs])
  }
  return new Map([...walls].map(([file, w]) => [file, quantile(w, 0.5)]))
}

function simulated(result: RunResult): Numbers {
  return {
    submitted: result.tasks.length,
    rejected: result.tasks.filter((t) => t.rejected).length,
    met: result.tasks.filter((t) => t.met).length,
    peakProcesses: result.peaks.processes,
    spawns: result.counts.spawns,
    timeouts: result.counts.timeouts,
    items: result.tasks.reduce((sum, t) => sum + t.done, 0),
  }
}

function real(run: ExhibitRun): Numbers {
  return {
    submitted: run.stats.submitted,
    rejected: run.stats.rejected,
    met: run.stats.met,
    peakProcesses: run.stats.peakProcesses,
    spawns: run.stats.spawns,
    timeouts: run.stats.exits.timeout ?? 0,
    items: run.stats.items,
  }
}

const rows = runs.map((run) => {
  const items = replayItems(manifest, measured(run.params.preset), run.params.preset)
  return { policy: run.policy, seed: run.params.seed, real: real(run), sim: simulated(replay(run, items, calibration)) }
})

const keys: Array<keyof Numbers> = ['submitted', 'rejected', 'met', 'peakProcesses', 'spawns', 'timeouts', 'items']
console.log(['policy', 'seed', ...keys.map((k) => `${k} real/sim`)].join('\t'))
for (const row of rows) {
  console.log([row.policy.padEnd(16), row.seed, ...keys.map((k) => `${row.real[k]}/${row.sim[k]}`)].join('\t'))
}

const byPolicy = new Map<string, typeof rows>()
for (const row of rows) byPolicy.set(row.policy, [...(byPolicy.get(row.policy) ?? []), row])
const summary = [...byPolicy].map(([policy, list]) => {
  const share = (n: Numbers) => (n.submitted ? n.met / n.submitted : 0)
  return {
    policy,
    runs: list.length,
    metShare: { real: mean(list.map((r) => share(r.real))), sim: mean(list.map((r) => share(r.sim))) },
    peakProcesses: { real: mean(list.map((r) => r.real.peakProcesses)), sim: mean(list.map((r) => r.sim.peakProcesses)) },
    spawns: { real: mean(list.map((r) => r.real.spawns)), sim: mean(list.map((r) => r.sim.spawns)) },
    timeouts: { real: mean(list.map((r) => r.real.timeouts)), sim: mean(list.map((r) => r.sim.timeouts)) },
    items: { real: mean(list.map((r) => r.real.items)), sim: mean(list.map((r) => r.sim.items)) },
  }
})
console.log('\npolicy\truns\ton time real/sim\tpeak real/sim\tspawns real/sim\ttimeouts real/sim\timages real/sim')
for (const s of summary) {
  const f = (v: { real: number; sim: number }, pct = false) =>
    pct ? `${(v.real * 100).toFixed(0)}%/${(v.sim * 100).toFixed(0)}%` : `${v.real.toFixed(0)}/${v.sim.toFixed(0)}`
  console.log(
    [s.policy.padEnd(16), s.runs, f(s.metShare, true), f(s.peakProcesses), f(s.spawns), f(s.timeouts), f(s.items)].join('\t'),
  )
}
if (values.out) writeFileSync(values.out, `${JSON.stringify({ steadyRssMb: calibration.steadyRssMb, rows, summary }, null, 2)}\n`)
