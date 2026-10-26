import { Injectable, Logger } from '@nestjs/common'
import type { ExitReason } from '@poof/contracts'
import type { BreakerState, LeaseState, PresetName } from '@poof/core'
import type { Prisma } from '@poof/db'
import { exitColumn, leaseColumn } from '../infra/columns.js'
import { Database } from '../infra/infra.module.js'

export interface TaskRow {
  id: string
  dataset: string
  offset: number
  preset: PresetName
  items: number
  policy: string
  exhibitId: string | null
  predictedMs: number
  submittedAt: Date
  deadline: Date
  traceId: string | null
}

export interface LeaseRow {
  id: string
  lo: number
  hi: number
  parentId: string | null
  depth: number
}

interface Progress {
  id: string
  done: number
  dead: number
}

@Injectable()
export class TaskStore {
  private readonly logger = new Logger(TaskStore.name)
  private writes: Promise<unknown> = Promise.resolve()

  constructor(private readonly db: Database) {}

  async reject(task: TaskRow, detail: Prisma.InputJsonObject): Promise<void> {
    await this.db.client.$transaction([
      this.db.client.task.create({ data: { ...task, status: 'REJECTED' } }),
      this.db.client.decision.create({ data: { kind: 'reject', taskId: task.id, detail } }),
    ])
  }

  async accept(task: TaskRow, leases: readonly LeaseRow[]): Promise<void> {
    await this.db.client.$transaction([
      this.db.client.task.create({ data: task }),
      this.db.client.lease.createMany({
        data: leases.map((lease) => ({ ...lease, taskId: task.id, cursor: lease.lo })),
      }),
    ])
  }

  started(taskId: string): void {
    this.write(() =>
      this.db.client.task.update({ where: { id: taskId }, data: { status: 'RUNNING', startedAt: new Date() } }),
    )
  }

  leaseCreated(taskId: string, lease: LeaseRow): void {
    this.write(() => this.db.client.lease.create({ data: { ...lease, taskId, cursor: lease.lo } }))
  }

  leaseRunning(leaseId: string, workerId: string, cursor: number): void {
    this.write(() =>
      this.db.client.lease.update({ where: { id: leaseId }, data: { state: 'RUNNING', workerId, cursor } }),
    )
  }

  leaseDone(leaseId: string, cursor: number): void {
    this.write(() => this.db.client.lease.update({ where: { id: leaseId }, data: { state: 'DONE', cursor } }))
  }

  leaseShrunk(leaseId: string, hi: number): void {
    this.write(() => this.db.client.lease.update({ where: { id: leaseId }, data: { hi } }))
  }

  leaseReleased(leaseId: string, state: LeaseState, cursor: number): void {
    this.write(() =>
      this.db.client.lease.update({
        where: { id: leaseId },
        data: { state: leaseColumn[state], cursor, workerId: null },
      }),
    )
  }

  workerStarted(workerId: string, pid: number): void {
    this.write(() => this.db.client.worker.create({ data: { id: workerId, pid } }))
  }

  workerExited(workerId: string, reason: ExitReason, items: number): void {
    this.write(() =>
      this.db.client.worker.update({
        where: { id: workerId },
        data: { endedAt: new Date(), exit: exitColumn[reason], items },
      }),
    )
  }

  deadLettered(taskId: string, item: number, attempts: number, error: string): void {
    this.write(() => this.db.client.deadLetter.create({ data: { taskId, item, attempts, error: error.slice(0, 500) } }))
  }

  decided(taskId: string, kind: 'worker-exit' | 'split', detail: Prisma.InputJsonObject): void {
    this.write(() => this.db.client.decision.create({ data: { kind, taskId, detail } }))
  }

  breakerChanged(type: PresetName, state: BreakerState): void {
    this.write(() => this.db.client.breakerEvent.create({ data: { type, state } }))
  }

  finished({ id, done, dead }: Progress, leases: ReadonlyArray<{ id: string; hi: number }>, at: Date): void {
    const cursors = leases.map((lease) => ({ id: lease.id, cursor: lease.hi }))
    this.write(() =>
      this.db.client.$transaction([
        this.db.client.task.update({
          where: { id },
          data: { status: 'DONE', finishedAt: at, done, deadLettered: dead },
        }),
        ...cursors.map((lease) =>
          this.db.client.lease.update({ where: { id: lease.id }, data: { state: 'DONE', cursor: lease.cursor } }),
        ),
      ]),
    )
  }

  failed({ id, done, dead }: Progress, kind: 'fail' | 'cancel', reason: string, at: Date): void {
    this.write(() =>
      this.db.client.$transaction([
        this.db.client.task.update({
          where: { id },
          data: { status: 'FAILED', finishedAt: at, done, deadLettered: dead },
        }),
        this.db.client.lease.updateMany({ where: { taskId: id, state: { not: 'DONE' } }, data: { state: 'DONE' } }),
        this.db.client.decision.create({ data: { kind, taskId: id, detail: { reason, dead } } }),
      ]),
    )
  }

  checkpoint(leases: ReadonlyArray<{ id: string; cursor: number }>, tasks: readonly Progress[]): void {
    if (leases.length === 0 && tasks.length === 0) return
    this.write(() =>
      this.db.client.$transaction([
        ...leases.map((l) => this.db.client.lease.update({ where: { id: l.id }, data: { cursor: l.cursor } })),
        ...tasks.map((t) =>
          this.db.client.task.update({ where: { id: t.id }, data: { done: t.done, deadLettered: t.dead } }),
        ),
      ]),
    )
  }

  flush(): Promise<unknown> {
    return this.writes
  }

  async releaseAfterRestart(): Promise<void> {
    await this.db.client.worker.updateMany({ where: { endedAt: null }, data: { endedAt: new Date(), exit: 'KILLED' } })
    await this.db.client.lease.updateMany({ where: { state: 'RUNNING' }, data: { state: 'PENDING', workerId: null } })
  }

  unfinishedTasks() {
    return this.db.client.task.findMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      include: { leases: { orderBy: { lo: 'asc' } }, deadLetters: { select: { item: true } } },
    })
  }

  private write(write: () => Promise<unknown>): void {
    this.writes = this.writes.then(write).catch((error: unknown) => this.logger.error(error))
  }
}
