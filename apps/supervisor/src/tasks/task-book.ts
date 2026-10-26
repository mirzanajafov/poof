import type { Breakers, PresetName } from '@poof/core'
import type { Prisma } from '@poof/db'
import { SpanStatusCode, traceIdOf, within, type Span, type Tracer } from '@poof/tracing'
import type { ExitReport, ItemDead, ItemDone } from '@poof/worker'
import type { Events } from '../infra/infra.module.js'
import type { Task, TaskLease } from './task.js'
import type { LeaseRow, TaskStore } from './task-store.js'

export type BookStore = Pick<
  TaskStore,
  | 'reject'
  | 'accept'
  | 'started'
  | 'decided'
  | 'leaseReleased'
  | 'deadLettered'
  | 'breakerChanged'
  | 'finished'
  | 'failed'
>

export interface BookRules {
  maxAttempts: number
  deadLetterShare: number
  deadLetter: boolean
}

export interface Placement {
  dataset: string
  offset: number
  policy: string
  exhibitId: string | null
}

export class TaskBook<Lease extends TaskLease> {
  readonly tasks = new Map<string, Task<Lease>>()
  readonly counts = { done: 0, met: 0, failed: 0, cancelled: 0, items: 0, deadLettered: 0 }

  constructor(
    private readonly store: BookStore,
    private readonly events: Pick<Events, 'publish'>,
    private readonly tracer: Tracer,
    readonly breakers: Breakers<PresetName>,
    private readonly rules: BookRules,
    private readonly stop: (lease: Lease) => void,
  ) {}

  active(): Array<Task<Lease>> {
    return [...this.tasks.values()].filter((task) => task.open)
  }

  async reject(task: Task<Lease>, placement: Placement, detail: Prisma.InputJsonObject): Promise<void> {
    await this.store.reject(this.row(task, placement), detail)
    this.events.publish({ kind: 'task.rejected', task: task.id, exhibit: placement.exhibitId })
    task.span.setAttributes({ 'poof.outcome': 'rejected' })
    task.span.end()
  }

  async accept(task: Task<Lease>, placement: Placement, leases: readonly LeaseRow[]): Promise<void> {
    await this.store.accept(this.row(task, placement), leases)
    this.tasks.set(task.id, task)
    this.events.publish({ kind: 'task.accepted', task: task.id, items: task.items, deadline: task.deadline })
  }

  start(task: Task<Lease>): void {
    if (task.status !== 'QUEUED') return
    task.status = 'RUNNING'
    this.store.started(task.id)
  }

  succeeded(task: Task<Lease>, lease: TaskLease, message: ItemDone): void {
    task.succeeded(message.item)
    this.counts.items++
    this.traceImage(lease.span, message)
    this.record(task.preset, true)
    this.events.publish({ kind: 'item', task: task.id, lease: lease.id, item: message.item, ok: true })
    this.settle(task)
  }

  failedItem(task: Task<Lease>, lease: TaskLease, message: ItemDead): void {
    this.traceImage(lease.span, message)
    this.deadLetter(task, message.item, message.attempts, message.error)
    this.events.publish({ kind: 'item', task: task.id, lease: lease.id, item: message.item, ok: false })
    this.settle(task)
  }

  track(task: Task<Lease>): void {
    this.tasks.set(task.id, task)
    this.settle(task)
  }

  forget(endedBefore: number): void {
    for (const task of this.tasks.values()) {
      const ended = task.finishedAt !== null && task.finishedAt < endedBefore
      if (ended && task.leases.every((lease) => lease.state === 'done')) this.tasks.delete(task.id)
    }
  }

  released(task: Task<Lease>, lease: TaskLease, exit: ExitReport): void {
    const inflight = exit.inflight
    if (task.open && inflight?.lease === lease.id && exit.reason !== 'normal') {
      const crash = task.crashed(inflight.item, this.rules.maxAttempts, this.rules.deadLetter)
      this.store.decided(task.id, 'worker-exit', { reason: exit.reason, item: crash.item, attempts: crash.attempts })
      if (crash.deadLettered) {
        this.deadLetter(task, crash.item, crash.attempts, `worker ${exit.reason}`)
        lease.cursor = crash.item + 1
      } else {
        this.record(task.preset, false)
        lease.cursor = crash.item
      }
    }
    this.putBack(task, lease)
    this.settle(task)
  }

  putBack(task: Task<Lease>, lease: TaskLease): void {
    lease.state = task.open && lease.cursor < lease.hi ? 'pending' : 'done'
    this.store.leaseReleased(lease.id, lease.state, lease.cursor)
  }

  fail(task: Task<Lease>, reason: string, kind: 'fail' | 'cancel' = 'fail'): void {
    if (!task.open) return
    task.status = 'FAILED'
    task.finishedAt = Date.now()
    for (const lease of task.leases) {
      if (lease.state === 'running') {
        this.stop(lease)
      } else if (lease.state !== 'done') {
        lease.state = 'done'
        lease.span?.end()
      }
    }
    if (kind === 'cancel') this.counts.cancelled++
    else this.counts.failed++
    this.store.failed(task, kind, reason, new Date(task.finishedAt))
    this.events.publish({ kind: 'task.failed', task: task.id, reason })
    task.span.setAttributes({
      'poof.outcome': kind === 'cancel' ? 'cancelled' : 'failed',
      'poof.reason': reason,
      'poof.done': task.done,
      'poof.dead': task.dead,
    })
    if (kind !== 'cancel') task.span.setStatus({ code: SpanStatusCode.ERROR, message: reason })
    task.span.end()
  }

  private settle(task: Task<Lease>): void {
    if (!task.open || !task.complete) return
    task.status = 'DONE'
    task.finishedAt = Date.now()
    const met = task.met
    this.counts.done++
    if (met) this.counts.met++
    const unfinished = task.leases.filter((lease) => lease.state !== 'done')
    this.store.finished(task, unfinished, new Date(task.finishedAt))
    for (const lease of unfinished) {
      if (lease.state === 'running') continue
      lease.state = 'done'
      lease.span?.end()
    }
    this.events.publish({ kind: 'task.done', task: task.id, met, dead: task.dead })
    task.span.setAttributes({ 'poof.outcome': met ? 'met' : 'late', 'poof.done': task.done, 'poof.dead': task.dead })
    task.span.end(task.finishedAt)
  }

  private deadLetter(task: Task<Lease>, item: number, attempts: number, error: string): void {
    task.deadLettered(item)
    this.counts.deadLettered++
    this.record(task.preset, false)
    this.store.deadLettered(task.id, item, attempts, error)
    this.events.publish({ kind: 'item.dead', task: task.id, item, attempts, error: error.slice(0, 200) })
    if (this.rules.deadLetter && task.tooManyDead(this.rules.deadLetterShare)) this.fail(task, 'too many dead letters')
  }

  private record(preset: PresetName, ok: boolean): void {
    const now = Date.now()
    const before = this.breakers.state(preset, now)
    this.breakers.record(preset, ok, now)
    const after = this.breakers.state(preset, now)
    if (after === before) return
    this.store.breakerChanged(preset, after)
    this.events.publish({ kind: 'breaker', preset, state: after })
  }

  private row(task: Task<Lease>, placement: Placement) {
    return {
      ...placement,
      id: task.id,
      preset: task.preset,
      items: task.items,
      predictedMs: task.remainingMs,
      submittedAt: new Date(task.submittedAt),
      deadline: new Date(task.deadline),
      traceId: traceIdOf(task.span),
    }
  }

  private traceImage(parent: Span | null, message: ItemDone | ItemDead): void {
    if (!parent) return
    if (message.ok) {
      this.tracer
        .startSpan(
          'image',
          {
            startTime: Date.now() - message.wallMs,
            attributes: {
              'poof.item': message.item,
              'poof.cpu_ms': Math.round(message.cpuMs),
              'poof.step_cpu_ms': Math.round(message.stepCpuMs),
            },
          },
          within(parent),
        )
        .end()
      return
    }
    const span = this.tracer.startSpan(
      'image',
      { attributes: { 'poof.item': message.item, 'poof.attempts': message.attempts } },
      within(parent),
    )
    span.setStatus({ code: SpanStatusCode.ERROR, message: message.error.slice(0, 200) })
    span.end()
  }
}
