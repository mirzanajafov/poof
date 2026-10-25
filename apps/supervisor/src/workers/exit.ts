import type { ExitReason } from '@poof/contracts'
import type { WorkerExit } from '@poof/db'

export const exitColumn: Record<ExitReason, WorkerExit> = {
  normal: 'NORMAL',
  crash: 'CRASH',
  memory: 'MEMORY',
  timeout: 'TIMEOUT',
  heartbeat: 'HEARTBEAT',
  killed: 'KILLED',
}
