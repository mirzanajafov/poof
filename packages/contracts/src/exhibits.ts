import type { ExhibitPolicyName, PresetName } from '@poof/core'
import type { ExitReason } from './workers.ts'

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

export function emptyExhibitStats(): ExhibitStats {
  return {
    submitted: 0,
    rejected: 0,
    done: 0,
    met: 0,
    cancelled: 0,
    failed: 0,
    items: 0,
    deadLettered: 0,
    spawns: 0,
    spawnFailures: 0,
    splits: 0,
    preemptions: 0,
    adoptions: 0,
    exits: {},
    peakProcesses: 0,
    maxDepth: 0,
  }
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
  budget: number | null
  processes: number
  stats: ExhibitStats
  tasks: ExhibitTaskView[]
}
