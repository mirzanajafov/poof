import type { ExitReason } from '@poof/contracts'
import type { LeaseState } from '@poof/core'
import type { LeaseState as LeaseColumn, WorkerExit } from '@poof/db'

export const exitColumn: Record<ExitReason, WorkerExit> = {
  normal: 'NORMAL',
  crash: 'CRASH',
  memory: 'MEMORY',
  timeout: 'TIMEOUT',
  heartbeat: 'HEARTBEAT',
  killed: 'KILLED',
}

export const leaseColumn: Record<LeaseState, LeaseColumn> = {
  pending: 'PENDING',
  starting: 'PENDING',
  running: 'RUNNING',
  done: 'DONE',
}
