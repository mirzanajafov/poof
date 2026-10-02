import { policies, variant, type PolicyConfig } from '@poof/core'
import type { MachineSpec } from './engine.ts'
import type { Scenario } from './workload.ts'

const minute = 60_000
const threadsPerWorker = 14
const supervisorThreads = 24

const base = {
  arrivalsMs: 60 * minute,
  drainMs: 30 * minute,
  utilization: 0.5,
  types: [{ weight: 1, value: 'webp-1600' }],
  items: [50, 1000] as [number, number],
  slack: [0.5, 3] as [number, number],
}

const event = { from: 20 * minute, to: 25 * minute }

export const scenarios: Record<string, Scenario> = {
  calm: { ...base, name: 'calm' },
  skew: { ...base, name: 'skew', skew: { share: 0.2, block: [0.1, 0.3], factor: [5, 10] } },
  neighbour: { ...base, name: 'neighbour', neighbour: { ...event, capacity: 0.5 } },
  burst: { ...base, name: 'burst', burst: { ...event, utilization: 1.5 } },
  poison: {
    ...base,
    name: 'poison',
    types: [
      { weight: 70, value: 'webp-1600' },
      { weight: 30, value: 'thumb-320' },
    ],
    poison: { share: 0.02, items: [1, 3], outage: { ...event, type: 'thumb-320' } },
  },
}

function machine(name: string, cores: number, memoryMb: number, pidsLimit: number): MachineSpec {
  return {
    name,
    cores,
    memoryMb,
    supervisorMb: 200,
    maxProcesses: Math.floor((pidsLimit - supervisorThreads) / threadsPerWorker),
  }
}

export const machines: Record<string, MachineSpec> = {
  cage: machine('cage', 1.5, 1536, 512),
  c2: machine('c2', 2, 2048, 512),
  c4: machine('c4', 4, 4096, 1024),
}

export const mainPolicies: PolicyConfig[] = [
  policies.never,
  policies.static,
  policies.pool,
  policies.box,
  policies.timerManaged,
  policies.forecast,
  policies.forecastManaged,
  policies.perfect,
  policies.forecastGreedy,
  policies.forecastPreempt,
]

export const sweepPolicies: PolicyConfig[] = [
  ...[0.5, 0.7, 0.85].map((threshold) => variant(policies.timerManaged, { name: `timer+budget θ=${threshold}`, threshold })),
  ...[1, 100].map((chunk) => variant(policies.pool, { name: `pool-${chunk}`, chunk })),
  ...[1, 2].map((z) => variant(policies.forecastManaged, { name: `forecast+budget z=${z}`, z })),
]

export function policyByName(name: string): PolicyConfig {
  const policy = [...mainPolicies, ...sweepPolicies].find((p) => p.name === name)
  if (!policy) throw new Error(`unknown policy ${name}`)
  return policy
}
