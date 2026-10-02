export interface Estimate {
  mean: number
  variance: number
  count: number
}

export interface TaskInfo {
  id: string
  type: string
  items: number
  submittedAt: number
  deadline: number
}

export type LeaseState = 'pending' | 'starting' | 'running' | 'done' | 'dead' | 'adopted'

export interface LeaseInfo {
  id: string
  taskId: string
  parentId: string | null
  depth: number
  lo: number
  hi: number
  next: number
  state: LeaseState
  startedAt: number | null
  lastSplitAt: number | null
  itemsDone: number
  itemMs: Estimate
  trueRemainingMs?: number
}

export type BreakerState = 'closed' | 'open' | 'half-open'

export interface View {
  now: number
  tasks: ReadonlyMap<string, TaskInfo>
  leases: readonly LeaseInfo[]
  breakers: ReadonlyMap<string, BreakerState>
  spawnMs: number
  killSwitch: boolean
}

export type Trigger = 'none' | 'timer' | 'forecast' | 'oracle'

export interface PolicyConfig {
  name: string
  engine: 'lease' | 'pool'
  trigger: Trigger
  threshold: number
  z: number
  warmupItems: number
  warmupMs: number
  cooldownMs: number
  margin: number
  maxDepth: number
  fanout: number
  upfront: number
  chunk: number
  budget: boolean
  admission: boolean
  breaker: boolean
  deadLetter: boolean
  greedy: boolean
  preempt: boolean
}

export interface Range {
  lo: number
  hi: number
}

export interface SplitRequest {
  leaseId: string
  taskId: string
  deadline: number
  k: number
  remaining: number
  pain: number
  projectedMs: number
  timeLeftMs: number
  itemMs: number
  opportunistic: boolean
}
