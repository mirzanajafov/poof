import type { PresetName } from '@poof/core'

export type SubmitRefusal = 'paused' | 'over-capacity'

export type SubmitResult =
  | { accepted: true; id: string; items: number; predictedSeconds: number }
  | { accepted: false; id: string | null; refusal: SubmitRefusal; reason: string; retryAfterSeconds: number }

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
