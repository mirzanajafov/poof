import type { ConcurrencyRow } from '@poof/contracts/bench'
import { valueAt } from '@poof/core'

export function kneeOf(rows: ReadonlyArray<Pick<ConcurrencyRow, 'k' | 'effectiveCores'>>): number {
  const flat = rows.find((row, i) => {
    const next = rows[i + 1]
    return next !== undefined && next.effectiveCores < row.effectiveCores * 1.05
  })
  return (flat ?? valueAt(rows, rows.length - 1)).k
}
