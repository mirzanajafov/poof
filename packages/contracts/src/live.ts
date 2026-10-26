import type { BreakerState, ExhibitPolicyName, PresetName } from '@poof/core'
import type { ExhibitEnd, ExhibitSnapshot, ExhibitStats } from './exhibits.ts'
import type { ExitReason } from './workers.ts'

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

type Field = 'string' | 'number' | 'boolean' | 'string or null' | 'object'

type Fields<K extends LiveEventBody['kind']> = Record<Exclude<keyof Extract<LiveEventBody, { kind: K }>, 'kind'>, Field>

const liveEventFields: { [K in LiveEventBody['kind']]: Fields<K> } = {
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
  'worker.exit': { worker: 'string', reason: 'string' },
  breaker: { preset: 'string', state: 'string' },
  'exhibit.started': { exhibit: 'string', policy: 'string', endsAt: 'number' },
  'exhibit.ended': { exhibit: 'string', status: 'string', stats: 'object' },
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
  if (typeof value !== 'object' || value === null || !('kind' in value) || !('at' in value)) return false
  if (typeof value.at !== 'number' || typeof value.kind !== 'string' || !isKind(value.kind)) return false
  const fields: Record<string, Field> = liveEventFields[value.kind]
  return Object.entries(fields).every(([name, field]) => matches(Reflect.get(value, name), field))
}

function isKind(kind: string): kind is LiveEventBody['kind'] {
  return Object.hasOwn(liveEventFields, kind)
}

function matches(value: unknown, field: Field): boolean {
  if (field === 'string or null') return value === null || typeof value === 'string'
  if (field === 'object') return typeof value === 'object' && value !== null
  return typeof value === field
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
