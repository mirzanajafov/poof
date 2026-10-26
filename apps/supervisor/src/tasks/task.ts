import type { LeaseState, PresetName } from '@poof/core'
import type { TaskStatus } from '@poof/db'
import type { Span } from '@poof/tracing'

export interface TaskSpec {
  id: string
  preset: PresetName
  items: number
  submittedAt: number
  deadline: number
  dir: string
  predicted: Float64Array
  span: Span
}

export interface TaskLease {
  readonly id: string
  readonly lo: number
  hi: number
  cursor: number
  state: LeaseState
  span: Span | null
}

export interface Crash {
  item: number
  attempts: number
  deadLettered: boolean
}

export class Task<Lease extends TaskLease = TaskLease> {
  readonly id: string
  readonly preset: PresetName
  readonly items: number
  readonly submittedAt: number
  readonly deadline: number
  readonly dir: string
  readonly predicted: Float64Array
  readonly span: Span
  readonly leases: Lease[] = []
  status: Exclude<TaskStatus, 'REJECTED'> = 'QUEUED'
  remainingMs: number
  done = 0
  dead = 0
  finishedAt: number | null = null
  private readonly attempts = new Map<number, number>()

  constructor(spec: TaskSpec) {
    this.id = spec.id
    this.preset = spec.preset
    this.items = spec.items
    this.submittedAt = spec.submittedAt
    this.deadline = spec.deadline
    this.dir = spec.dir
    this.predicted = spec.predicted
    this.span = spec.span
    this.remainingMs = spec.predicted.reduce((sum, ms) => sum + ms, 0)
  }

  get open(): boolean {
    return this.status === 'QUEUED' || this.status === 'RUNNING'
  }

  get complete(): boolean {
    return this.done + this.dead >= this.items
  }

  get met(): boolean {
    return this.status === 'DONE' && this.finishedAt !== null && this.finishedAt <= this.deadline
  }

  restore(status: 'QUEUED' | 'RUNNING', dead: number): void {
    let processed = 0
    this.remainingMs = 0
    for (const lease of this.leases) {
      if (lease.state === 'done') {
        processed += lease.hi - lease.lo
      } else {
        processed += lease.cursor - lease.lo
        this.remainingMs += this.predicted.subarray(lease.cursor, lease.hi).reduce((sum, ms) => sum + ms, 0)
      }
    }
    this.status = status
    this.dead = dead
    this.done = processed - dead
  }

  attemptsAt(item: number): number {
    return this.attempts.get(item) ?? 0
  }

  costOf(item: number): number {
    const cost = this.predicted[item]
    if (cost === undefined) throw new RangeError(`task ${this.id} has no item ${item}`)
    return cost
  }

  succeeded(item: number): void {
    this.done++
    this.remainingMs -= this.costOf(item)
  }

  deadLettered(item: number): void {
    this.dead++
    this.remainingMs -= this.costOf(item)
  }

  crashed(item: number, maxAttempts: number, deadLetter: boolean): Crash {
    const attempts = this.attemptsAt(item) + 1
    this.attempts.set(item, attempts)
    return { item, attempts, deadLettered: deadLetter && attempts >= maxAttempts }
  }

  tooManyDead(share: number): boolean {
    return this.dead > share * this.items
  }
}
