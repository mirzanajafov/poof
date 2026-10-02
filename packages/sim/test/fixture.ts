import type { Calibration } from '../src/calibration.ts'
import type { MachineSpec } from '../src/engine.ts'
import type { Scenario } from '../src/workload.ts'

export const calibration: Calibration = {
  label: 'fixture',
  types: {
    'webp-1600': { coefMs: 161, exponent: 0.35, logResidualSd: 0.41 },
    'thumb-320': { coefMs: 12.8, exponent: 0.58, logResidualSd: 0.42 },
  },
  spawnMs: 160,
  spawnCpuMs: 190,
  baseRssMb: 69,
  steadyRssMb: 150,
  curves: [
    {
      cpus: 2,
      knee: 2,
      points: [1, 1.9, 1.95, 1.9, 1.85, 1.8].map((effectiveCores, i) => ({ workers: i + 1, effectiveCores })),
    },
  ],
}

export const machine: MachineSpec = { name: 'test', cores: 2, memoryMb: 2048, supervisorMb: 200, maxProcesses: 35 }

const minute = 60_000

export const shortScenario: Scenario = {
  name: 'short',
  arrivalsMs: 10 * minute,
  drainMs: 10 * minute,
  utilization: 0.5,
  types: [{ weight: 1, value: 'webp-1600' }],
  items: [30, 300],
  slack: [0.5, 3],
}

export const burstScenario: Scenario = {
  ...shortScenario,
  name: 'short-burst',
  burst: { from: 3 * minute, to: 6 * minute, utilization: 1.5 },
}

export const poisonScenario: Scenario = {
  ...shortScenario,
  name: 'short-poison',
  types: [
    { weight: 70, value: 'webp-1600' },
    { weight: 30, value: 'thumb-320' },
  ],
  poison: { share: 0.3, items: [1, 3], outage: { from: 3 * minute, to: 5 * minute, type: 'thumb-320' } },
}
