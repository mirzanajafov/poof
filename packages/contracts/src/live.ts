import type { ExhibitEnd, ExhibitPolicyName, ExhibitSnapshot, ExhibitStats } from './exhibits.ts'
import type { BreakerState, ExitReason, PresetName } from './vocabulary.ts'

export const liveEventsChannel = 'poof:events'
export const poolSnapshotKey = 'poof:live'
export const exhibitSnapshotKey = 'poof:exhibit'

export type LiveEventBody =
  | { kind: 'task.accepted'; task: string; items: number; deadline: number }
  | { kind: 'task.rejected'; task: string; exhibit: string | null }
  | { kind: 'task.done'; task: string; met: boolean; dead: number }
  | { kind: 'task.failed'; task: string; reason: string }
  | { kind: 'lease.claimed'; task: string; lease: string; worker: string; lo: number; hi: number }
  | { kind: 'lease.created'; task: string; lease: string; parent: string | null; depth: number; lo: number; hi: number }
  | { kind: 'item'; task: string; lease: string; item: number; ok: boolean }
  | { kind: 'item.dead'; task: string; item: number; attempts: number; error: string }
  | { kind: 'worker.spawned'; worker: string; pid: number }
  | { kind: 'worker.exit'; worker: string; reason: ExitReason }
  | { kind: 'breaker'; preset: PresetName; state: BreakerState }
  | { kind: 'exhibit.started'; exhibit: string; policy: ExhibitPolicyName; endsAt: number }
  | { kind: 'exhibit.ended'; exhibit: string; status: ExhibitEnd; stats: ExhibitStats }

export type LiveEvent = LiveEventBody & { at: number }

export interface PoolWorkerView {
  id: string
  pid: number
  items: number
  task: string | null
  lease: { lo: number; hi: number; cursor: number } | null
}

export interface PoolTaskView {
  id: string
  preset: PresetName
  items: number
  done: number
  dead: number
  deadline: number
}

export interface PoolSnapshot {
  at: number
  budget: number
  workers: PoolWorkerView[]
  tasks: PoolTaskView[]
  breakers: Partial<Record<PresetName, BreakerState>>
}

export interface LiveSnapshot {
  live: PoolSnapshot | null
  exhibit: ExhibitSnapshot | null
}

export interface LiveBatch {
  events: LiveEvent[]
  dropped: number
}

export interface LiveSocketEvents {
  snapshot: (snapshot: LiveSnapshot) => void
  events: (batch: LiveBatch) => void
}
