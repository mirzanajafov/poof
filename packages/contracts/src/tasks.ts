import type { PresetName } from '@poof/core'

export type SubmitRefusal = 'paused' | 'over-capacity'

export type SubmitResult =
  | { accepted: true; id: string; items: number; predictedSeconds: number }
  | { accepted: false; id: string | null; refusal: SubmitRefusal; reason: string; retryAfterSeconds: number }

export function parseSubmitResult(value: unknown): SubmitResult | null {
  if (typeof value !== 'object' || value === null || !('accepted' in value)) return null
  const fields = new Map<string, unknown>(Object.entries(value))
  const id = fields.get('id')
  if (value.accepted === true) {
    const items = fields.get('items')
    const predictedSeconds = fields.get('predictedSeconds')
    if (typeof id !== 'string' || typeof items !== 'number' || typeof predictedSeconds !== 'number') return null
    return { accepted: true, id, items, predictedSeconds }
  }
  const refusal = fields.get('refusal')
  const reason = fields.get('reason')
  const retryAfterSeconds = fields.get('retryAfterSeconds')
  if (value.accepted !== false || (id !== null && typeof id !== 'string') || typeof reason !== 'string') return null
  if ((refusal !== 'paused' && refusal !== 'over-capacity') || typeof retryAfterSeconds !== 'number') return null
  return { accepted: false, id, refusal, reason, retryAfterSeconds }
}

export type TaskStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'REJECTED'

export interface TaskDetail {
  id: string
  dataset: string
  preset: PresetName
  items: number
  policy: string
  status: TaskStatus
  done: number
  deadLettered: number
  predictedMs: number
  submittedAt: string
  deadline: string
  startedAt: string | null
  finishedAt: string | null
  leases: Array<{
    id: string
    lo: number
    hi: number
    cursor: number
    state: 'PENDING' | 'RUNNING' | 'DONE'
    depth: number
  }>
  deadLetters: Array<{ item: number; attempts: number; error: string }>
  decisions: Array<{ id: string; at: string; kind: string; detail: Record<string, unknown> }>
}
