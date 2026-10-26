import type { ExhibitDetail } from '@poof/contracts'
import type { ExhibitRun } from '@poof/contracts/bench'

export function finishedRun({ id, policy, status, params, stats, tasks }: ExhibitDetail): ExhibitRun | null {
  return status === 'DONE' && stats ? { id, policy, params, stats, tasks } : null
}
