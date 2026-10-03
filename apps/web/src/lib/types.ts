export interface LiveWorker {
  id: string
  pid: number
  items: number
  task: string | null
  lease: { lo: number; hi: number; cursor: number } | null
}

export interface LiveTask {
  id: string
  preset: string
  items: number
  done: number
  dead: number
  deadline: number
  status: string
}

export interface LiveSnapshot {
  at: number
  budget: number
  workers: LiveWorker[]
  tasks: LiveTask[]
  breakers: Record<string, string>
}

export interface ExhibitLease {
  id: string
  parent: string | null
  depth: number
  lo: number
  hi: number
  cursor: number
  state: 'pending' | 'starting' | 'running' | 'done'
  pid: number | null
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
  exits: Record<string, number>
  peakProcesses: number
  maxDepth: number
}

export interface ExhibitSnapshot {
  id: string
  policy: string
  params: { policy: string; durationSeconds: number; utilization: number; dataset: string }
  startedAt: number
  endsAt: number
  budget: number | null
  processes: number
  stats: ExhibitStats
  tasks: Array<{ id: string; items: number; done: number; deadline: number; leases: ExhibitLease[] }>
}

export interface Snapshot {
  live: LiveSnapshot | null
  exhibit: ExhibitSnapshot | null
}

export interface LiveEvent {
  kind: string
  at: number
  [key: string]: unknown
}

export interface Dataset {
  name: string
  items: number
  meanMp: number
}
