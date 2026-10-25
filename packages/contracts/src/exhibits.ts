import type { ExitReason, PresetName } from './vocabulary.ts'

export const exhibitPolicyNames = [
  'pool',
  'never',
  'static-4',
  'box',
  'timer+budget',
  'forecast',
  'forecast+budget',
  'forecast+preempt',
] as const

export type ExhibitPolicyName = (typeof exhibitPolicyNames)[number]

export function isExhibitPolicyName(name: string): name is ExhibitPolicyName {
  const names: readonly string[] = exhibitPolicyNames
  return names.includes(name)
}

export interface ExhibitParams {
  policy: ExhibitPolicyName
  durationSeconds: number
  utilization: number
  dataset: string
  preset: PresetName
  minItems: number
  maxItems: number
  slackMin: number
  slackMax: number
  seed: number
}

export interface ExhibitStats {
  submitted: number
  rejected: number
  done: number
  met: number
  cancelled: number
  failed: number
  items: number
  deadLettered: number
  spawns: number
  spawnFailures: number
  splits: number
  preemptions: number
  adoptions: number
  exits: Partial<Record<ExitReason, number>>
  peakProcesses: number
  maxDepth: number
}

export type ExhibitEnd = 'DONE' | 'ABORTED'

export interface ExhibitLeaseView {
  id: string
  parent: string | null
  depth: number
  lo: number
  hi: number
  cursor: number
  state: 'pending' | 'starting' | 'running' | 'done'
  pid: number | null
}

export interface ExhibitTaskView {
  id: string
  items: number
  done: number
  deadline: number
  leases: ExhibitLeaseView[]
}

export interface ExhibitSnapshot {
  id: string
  params: ExhibitParams
  startedAt: number
  endsAt: number
  policy: ExhibitPolicyName
  budget: number | null
  processes: number
  stats: ExhibitStats
  tasks: ExhibitTaskView[]
}
