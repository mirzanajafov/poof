import { mkdir, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { Worker } from 'node:worker_threads'
import { loadCalibration } from './calibration.ts'
import type { Sample } from './engine.ts'
import type { RunMetrics } from './metrics.ts'
import { count, knownNames, positive } from './options.ts'
import { compare, summarize, table, type Comparison } from './report.ts'
import type { Job } from './run-worker.ts'
import { allPolicies, machines, mainPolicies, scenarios, sweepPolicies } from './scenarios.ts'

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
  if (spec === 'all') return allPolicies.map((p) => p.name)
  return knownNames(
    spec,
    allPolicies.map((p) => p.name),
    'policy',
  )
}

const machineNames = knownNames(values.machines, Object.keys(machines), 'machine')
const scenarioNames = knownNames(values.scenarios, Object.keys(scenarios), 'scenario')
const policies = policyNames(values.policies)
const seeds = count('seeds', values.seeds)
const threads = count('threads', values.threads)
const dtMs = positive('dt', values.dt)
const calibration = loadCalibration(values.calibration)
const jobs: Job[] = []
for (const machine of machineNames) {
  for (const scenario of scenarioNames) {
    for (const policy of policies) {
      for (let seed = 1; seed <= seeds; seed++) {
        jobs.push({
          machine,
          scenario,
          policy,
          seed,
          dtMs,
          keepSeries: seed === 1,
          checkInvariants: values.invariants,
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
  const workers = Math.min(threads, jobs.length)
  let idle = 0
  for (let i = 0; i < workers; i++) {
    const worker = new Worker(workerPath, { workerData: { calibration } })
    const next = () => {
      const job = queue.shift()
      if (job) worker.postMessage(job)
      else {
        void worker.terminate()
        if (++idle === workers) resolve()
      }
    }
    worker.on('message', (message: { metrics: RunMetrics; series: Sample[] | null; runMs: number }) => {
      metrics.push(message.metrics)
      if (message.series) {
        const { machine, scenario, policy } = message.metrics
        series.push({ machine, scenario, policy, samples: message.series })
      }
      runMs += message.runMs
      if (++finished % 100 === 0 || finished === jobs.length) {
        process.stdout.write(
          `\r${finished}/${jobs.length} runs, ${((performance.now() - started) / 1000).toFixed(0)} s`,
        )
      }
      next()
    })
    worker.on('error', reject)
    next()
  }
})

const cells = summarize(metrics)
const comparisons: Comparison[] = []
for (const machine of machineNames) {
  for (const scenario of scenarioNames) {
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
console.log(
  `\nsimulated ${jobs.length} runs in ${((performance.now() - started) / 1000).toFixed(1)} s, ${(runMs / jobs.length).toFixed(0)} ms per run`,
)

const out = values.out ?? fileURLToPath(new URL(`../results/${values.calibration}/`, import.meta.url))
await mkdir(join(out, 'raw'), { recursive: true })
await writeFile(join(out, 'raw', 'metrics.json'), JSON.stringify(metrics))
await writeFile(join(out, 'raw', 'series.json'), JSON.stringify(series))
await writeFile(
  join(out, 'summary.json'),
  `${JSON.stringify({ calibration, seeds, dtMs, cells, comparisons }, null, 2)}\n`,
)
console.log(`wrote ${out}`)
