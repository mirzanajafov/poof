import { parentPort, workerData } from 'node:worker_threads'
import type { Calibration } from './calibration.ts'
import { Simulation } from './engine.ts'
import { derive } from './metrics.ts'
import { machines, policyByName, scenarios } from './scenarios.ts'

export interface Job {
  machine: string
  scenario: string
  policy: string
  seed: number
  dtMs: number
  keepSeries: boolean
  checkInvariants: boolean
}

const { calibration } = workerData as { calibration: Calibration }

parentPort!.on('message', (job: Job) => {
  const scenario = scenarios[job.scenario]!
  const simulation = new Simulation({
    scenario,
    machine: machines[job.machine]!,
    policy: policyByName(job.policy),
    calibration,
    seed: job.seed,
    dtMs: job.dtMs,
    recordSeries: true,
    checkInvariants: job.checkInvariants,
  })
  const started = performance.now()
  const result = simulation.run()
  parentPort!.postMessage({
    metrics: derive(result, scenario),
    series: job.keepSeries ? result.series : null,
    runMs: performance.now() - started,
  })
})
