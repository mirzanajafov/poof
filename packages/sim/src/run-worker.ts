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

const port = parentPort
if (!port) throw new Error('run-worker runs only as a worker thread')
const { calibration } = workerData as { calibration: Calibration }

port.on('message', (job: Job) => {
  const scenario = scenarios[job.scenario]
  const machine = machines[job.machine]
  if (!scenario) throw new Error(`no scenario ${job.scenario}`)
  if (!machine) throw new Error(`no machine ${job.machine}`)
  const simulation = new Simulation({
    scenario,
    machine,
    policy: policyByName(job.policy),
    calibration,
    seed: job.seed,
    dtMs: job.dtMs,
    recordSeries: true,
    itemTimeouts: true,
    checkInvariants: job.checkInvariants,
  })
  const started = performance.now()
  const result = simulation.run()
  port.postMessage({
    metrics: derive(result, scenario),
    series: job.keepSeries ? result.series : null,
    runMs: performance.now() - started,
  })
})
