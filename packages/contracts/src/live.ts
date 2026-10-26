import {
  breakerStates,
  exhibitPolicyNames,
  presetNames,
  type BreakerState,
  type ExhibitPolicyName,
  type PresetName,
} from '@poof/core'
import { exhibitEnds, type ExhibitEnd, type ExhibitSnapshot, type ExhibitStats } from './exhibits.ts'
import { hasFields, isRecord, type Checks } from './records.ts'
import { exitReasons, type ExitReason } from './workers.ts'

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

type Body<K extends LiveEventBody['kind']> = Extract<LiveEventBody, { kind: K }>

const liveEventChecks: { [K in LiveEventBody['kind']]: Checks<Omit<Body<K>, 'kind'>> } = {
  'task.accepted': { task: 'string', items: 'number', deadline: 'number' },
  'task.rejected': { task: 'string', exhibit: 'string or null' },
  'task.done': { task: 'string', met: 'boolean', dead: 'number' },
  'task.failed': { task: 'string', reason: 'string' },
  'lease.claimed': { task: 'string', lease: 'string', worker: 'string', lo: 'number', hi: 'number' },
  'lease.created': {
    task: 'string',
    lease: 'string',
    parent: 'string or null',
    depth: 'number',
    lo: 'number',
    hi: 'number',
  },
  item: { task: 'string', lease: 'string', item: 'number', ok: 'boolean' },
  'item.dead': { task: 'string', item: 'number', attempts: 'number', error: 'string' },
  'worker.spawned': { worker: 'string', pid: 'number' },
  'worker.exit': { worker: 'string', reason: exitReasons },
  breaker: { preset: presetNames, state: breakerStates },
  'exhibit.started': { exhibit: 'string', policy: exhibitPolicyNames, endsAt: 'number' },
  'exhibit.ended': { exhibit: 'string', status: exhibitEnds, stats: 'object' },
}

export function parseLiveEvent(text: string): LiveEvent | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  return isLiveEvent(value) ? value : null
}

function isLiveEvent(value: unknown): value is LiveEvent {
  if (!isRecord(value) || typeof value.at !== 'number' || typeof value.kind !== 'string' || !isKind(value.kind)) {
    return false
  }
  const checks: Checks<object> = liveEventChecks[value.kind]
  return hasFields(value, checks)
}

function isKind(kind: string): kind is LiveEventBody['kind'] {
  return Object.hasOwn(liveEventChecks, kind)
}

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
  paused: boolean
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
