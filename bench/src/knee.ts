import type { ConcurrencyRow } from '@poof/contracts/bench'
import { valueAt } from '@poof/core'

export function kneeOf(rows: ReadonlyArray<Pick<ConcurrencyRow, 'k' | 'effectiveCores'>>): number {
  const byWorkers = [...rows].sort((a, b) => a.k - b.k)
  const flat = byWorkers.find((row, i) => {
    const next = byWorkers[i + 1]
    return next !== undefined && next.effectiveCores < row.effectiveCores * 1.05
  })
  return (flat ?? valueAt(byWorkers, byWorkers.length - 1)).k
}
