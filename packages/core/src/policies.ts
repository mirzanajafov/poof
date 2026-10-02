import type { PolicyConfig } from './types.ts'

const defaults = {
  threshold: 1,
  z: 0,
  warmupItems: 10,
  warmupMs: 2000,
  cooldownMs: 3000,
  margin: 0.1,
  fanout: 4,
  upfront: 1,
  chunk: 0,
  greedy: false,
  preempt: false,
} as const

const managed = { budget: true, admission: true, breaker: true, deadLetter: true } as const
const unmanaged = { budget: false, admission: false, breaker: false, deadLetter: false } as const

export const policies = {
  never: { ...defaults, ...managed, name: 'never', engine: 'lease', trigger: 'none', maxDepth: 0 },
  static: { ...defaults, ...managed, name: 'static-4', engine: 'lease', trigger: 'none', maxDepth: 0, upfront: 4 },
  pool: { ...defaults, ...managed, name: 'pool-10', engine: 'pool', trigger: 'none', maxDepth: 0, chunk: 10 },
  box: { ...defaults, ...unmanaged, name: 'box', engine: 'lease', trigger: 'timer', maxDepth: Infinity },
  timerManaged: { ...defaults, ...managed, name: 'timer+budget', engine: 'lease', trigger: 'timer', maxDepth: 3 },
  forecast: { ...defaults, ...unmanaged, name: 'forecast', engine: 'lease', trigger: 'forecast', maxDepth: 3 },
  forecastManaged: { ...defaults, ...managed, name: 'forecast+budget', engine: 'lease', trigger: 'forecast', maxDepth: 3 },
  perfect: { ...defaults, ...managed, name: 'perfect', engine: 'lease', trigger: 'oracle', maxDepth: 3 },
  forecastGreedy: {
    ...defaults,
    ...managed,
    name: 'forecast+idle',
    engine: 'lease',
    trigger: 'forecast',
    maxDepth: 3,
    greedy: true,
  },
  forecastPreempt: {
    ...defaults,
    ...managed,
    name: 'forecast+preempt',
    engine: 'lease',
    trigger: 'forecast',
    maxDepth: 3,
    greedy: true,
    preempt: true,
  },
} satisfies Record<string, PolicyConfig>

export type PolicyKey = keyof typeof policies

export function variant(base: PolicyConfig, overrides: Partial<PolicyConfig>): PolicyConfig {
  return { ...base, ...overrides }
}
