import type { ExhibitPolicyName, LeaseState, PresetName } from '@poof/core'
import type { TaskStatus } from './tasks.ts'
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

export const exhibitDefaults: Readonly<Omit<ExhibitParams, 'policy'>> = {
  durationSeconds: 60,
  utilization: 1.2,
  dataset: 'synthetic',
  preset: 'webp-1600',
  minItems: 20,
  maxItems: 120,
  slackMin: 0.5,
  slackMax: 3,
  seed: 1,
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

export const exhibitEnds = ['DONE', 'ABORTED'] as const

export type ExhibitEnd = (typeof exhibitEnds)[number]

export interface ExhibitLeaseView {
  id: string
  parent: string | null
  depth: number
  lo: number
  hi: number
  cursor: number
  state: LeaseState
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

export interface ExhibitDetail {
  id: string
  policy: ExhibitPolicyName
  status: 'RUNNING' | ExhibitEnd
  startedAt: string
  endedAt: string | null
  params: ExhibitParams
  stats: ExhibitStats | null
  tasks: Array<{
    id: string
    status: TaskStatus
    items: number
    done: number
    submittedAt: string
    deadline: string
    finishedAt: string | null
  }>
}
