import type { ExitReason } from '@poof/contracts'

export const exitColumn: Record<ExitReason, 'NORMAL' | 'CRASH' | 'MEMORY' | 'TIMEOUT' | 'HEARTBEAT' | 'KILLED'> = {
  normal: 'NORMAL',
  crash: 'CRASH',
  memory: 'MEMORY',
  timeout: 'TIMEOUT',
  heartbeat: 'HEARTBEAT',
  killed: 'KILLED',
}
