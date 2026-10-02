import { mkdir, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { Worker } from 'node:worker_threads'
import { loadCalibration } from './calibration.ts'
import type { Sample } from './engine.ts'
import type { RunMetrics } from './metrics.ts'
import { compare, summarize, table, type Comparison } from './report.ts'
import type { Job } from './run-worker.ts'
import { machines, mainPolicies, scenarios, sweepPolicies } from './scenarios.ts'

const { values } = parseArgs({
  options: {
    calibration: { type: 'string', default: 'dev-linux' },
    machines: { type: 'string', default: Object.keys(machines).join(',') },
    scenarios: { type: 'string', default: Object.keys(scenarios).join(',') },
    policies: { type: 'string', default: 'main' },
    seeds: { type: 'string', default: '20' },
    threads: { type: 'string', default: String(Math.max(1, availableParallelism() - 2)) },
    dt: { type: 'string', default: '10' },
    out: { type: 'string' },
    invariants: { type: 'boolean', default: false },
  },
})

function policyNames(spec: string): string[] {
  if (spec === 'main') return mainPolicies.map((p) => p.name)
  if (spec === 'sweep') return sweepPolicies.map((p) => p.name)
  if (spec === 'all') return [...mainPolicies, ...sweepPolicies].map((p) => p.name)
  return spec.split(',')
}

const calibration = loadCalibration(values.calibration!)
const seeds = Number(values.seeds)
const jobs: Job[] = []
for (const machine of values.machines!.split(',')) {
  for (const scenario of values.scenarios!.split(',')) {
    for (const policy of policyNames(values.policies!)) {
      for (let seed = 1; seed <= seeds; seed++) {
        jobs.push({
          machine,
          scenario,
          policy,
          seed,
          dtMs: Number(values.dt),
          keepSeries: seed === 1,
          checkInvariants: values.invariants!,
        })
      }
    }
  }
}

const metrics: RunMetrics[] = []
const series: Array<{ machine: string; scenario: string; policy: string; samples: Sample[] }> = []
let finished = 0
let runMs = 0
const started = performance.now()
const workerPath = fileURLToPath(new URL('./run-worker.js', import.meta.url))

await new Promise<void>((resolve, reject) => {
  const queue = [...jobs]
  const threads = Math.min(Number(values.threads), jobs.length)
  let idle = 0
  for (let i = 0; i < threads; i++) {
    const worker = new Worker(workerPath, { workerData: { calibration } })
    let current: Job | undefined
    const next = () => {
      current = queue.shift()
      if (current) worker.postMessage(current)
      else {
        void worker.terminate()
        if (++idle === threads) resolve()
      }
    }
    worker.on('message', (message: { metrics: RunMetrics; series: Sample[] | null; runMs: number }) => {
      metrics.push(message.metrics)
      if (message.series) series.push({ machine: current!.machine, scenario: current!.scenario, policy: current!.policy, samples: message.series })
      runMs += message.runMs
      if (++finished % 100 === 0 || finished === jobs.length) {
        process.stdout.write(`\r${finished}/${jobs.length} runs, ${((performance.now() - started) / 1000).toFixed(0)} s`)
      }
      next()
    })
    worker.on('error', reject)
    next()
  }
})

const cells = summarize(metrics)
const comparisons: Comparison[] = []
for (const machine of values.machines!.split(',')) {
  for (const scenario of values.scenarios!.split(',')) {
    const pairs: Array<[string, string, Parameters<typeof compare>[5]]> = [
      ['forecast+budget', 'timer+budget', 'hitRate'],
      ['forecast+budget', 'timer+budget', 'skewedHitRate'],
      ['forecast+budget', 'forecast', 'hitRate'],
      ['forecast+budget', 'never', 'hitRate'],
      ['forecast+budget', 'pool-10', 'hitRate'],
      ['forecast+budget', 'static-4', 'hitRate'],
      ['perfect', 'forecast+budget', 'hitRate'],
      ['forecast+budget', 'pool-10', 'cpuPerItemMs'],
    ]
    for (const [a, b, metric] of pairs) {
      const comparison = compare(metrics, machine, scenario, a, b, metric)
      if (comparison) comparisons.push(comparison)
    }
  }
}

console.log(`\n${table(cells)}`)
console.log(`\nsimulated ${jobs.length} runs in ${((performance.now() - started) / 1000).toFixed(1)} s, ${(runMs / jobs.length).toFixed(0)} ms per run`)

const out = values.out ?? fileURLToPath(new URL(`../results/${values.calibration}/`, import.meta.url))
await mkdir(join(out, 'raw'), { recursive: true })
await writeFile(join(out, 'raw', 'metrics.json'), JSON.stringify(metrics))
await writeFile(join(out, 'raw', 'series.json'), JSON.stringify(series))
await writeFile(
  join(out, 'summary.json'),
  `${JSON.stringify({ calibration, seeds, dtMs: Number(values.dt), cells, comparisons }, null, 2)}\n`,
)
console.log(`wrote ${out}`)
