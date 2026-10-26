import type { PresetName } from '@poof/core'
import { isRecord } from './records.ts'

export const submitRefusals = ['paused', 'over-capacity'] as const

export type SubmitRefusal = (typeof submitRefusals)[number]

export type SubmitResult =
  | { accepted: true; id: string; items: number; predictedSeconds: number }
  | { accepted: false; id: string | null; refusal: SubmitRefusal; reason: string; retryAfterSeconds: number }

export function parseSubmitResult(value: unknown): SubmitResult | null {
  if (!isRecord(value)) return null
  const { accepted, id, items, predictedSeconds, refusal, reason, retryAfterSeconds } = value
  if (accepted === true) {
    if (typeof id !== 'string' || typeof items !== 'number' || typeof predictedSeconds !== 'number') return null
    return { accepted, id, items, predictedSeconds }
  }
  if (accepted !== false || (id !== null && typeof id !== 'string')) return null
  if (typeof reason !== 'string' || typeof retryAfterSeconds !== 'number') return null
  const kind = submitRefusals.find((known) => known === refusal)
  return kind ? { accepted, id, refusal: kind, reason, retryAfterSeconds } : null
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
