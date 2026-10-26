import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { parseManifest } from '@poof/contracts'
import { itemCostMedians, parseExhibitRuns, type ExhibitRunStats } from '@poof/contracts/bench'
import { defaultTimeoutRule } from '@poof/core'
import { mean } from '@poof/core/stats'
import { itemCostSamples, loadCalibration } from './calibration.ts'
import type { RunResult } from './engine.ts'
import { replay, replayItems } from './replay.ts'

const { values } = parseArgs({
  options: {
    runs: { type: 'string' },
    calibration: { type: 'string', default: 'server' },
    manifest: { type: 'string' },
    'steady-rss': { type: 'string' },
    'timeout-growth': { type: 'string', default: '2' },
    speed: { type: 'string', default: '1' },
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

if (!values.runs || !values.manifest) {
  throw new Error('usage: replay --runs <exhibit runs file> --manifest <dataset manifest> [--calibration <label>]')
}
const calibration = loadCalibration(values.calibration)
if (values['steady-rss']) calibration.steadyRssMb = Number(values['steady-rss'])
const timeoutRule = { ...defaultTimeoutRule, growth: Number(values['timeout-growth']) }
const speed = Number(values.speed)
const samples = itemCostSamples(values.calibration)
const runs = parseExhibitRuns(readFileSync(values.runs, 'utf8'), values.runs)
const manifest = parseManifest(readFileSync(values.manifest, 'utf8'), values.manifest).items

function measured(preset: string): Map<string, number> {
  return new Map([...itemCostMedians(samples, preset, 'synthetic')].map(([file, ms]) => [file, ms / speed]))
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

function real(stats: ExhibitRunStats): Numbers {
  return {
    submitted: stats.submitted,
    rejected: stats.rejected,
    met: stats.met,
    peakProcesses: stats.peakProcesses,
    spawns: stats.spawns,
    timeouts: stats.exits.timeout ?? 0,
    items: stats.items,
  }
}

const rows = runs.map((run) => {
  const items = replayItems(manifest, measured(run.params.preset), run.params.preset)
  return {
    policy: run.params.policy,
    seed: run.params.seed,
    real: real(run.stats),
    sim: simulated(replay(run.params, items, calibration, timeoutRule)),
  }
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
    peakProcesses: {
      real: mean(list.map((r) => r.real.peakProcesses)),
      sim: mean(list.map((r) => r.sim.peakProcesses)),
    },
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
    [s.policy.padEnd(16), s.runs, f(s.metShare, true), f(s.peakProcesses), f(s.spawns), f(s.timeouts), f(s.items)].join(
      '\t',
    ),
  )
}
if (values.out) {
  const memory = { baseMb: calibration.baseRssMb, steadyMb: calibration.steadyRssMb }
  writeFileSync(values.out, `${JSON.stringify({ memory, timeoutRule, speed, rows, summary }, null, 2)}\n`)
}
