import type { Range } from './types.ts'

export function finishMs(remaining: number, itemMs: number, spawnMs: number, k: number): number {
  return (remaining * itemMs + k * spawnMs) / (k + 1)
}

export function chooseK(
  remaining: number,
  itemMs: number,
  spawnMs: number,
  timeLeftMs: number,
  fanout: number,
  margin: number,
): number {
  const target = timeLeftMs * (1 - margin)
  for (let k = 1; k <= fanout; k++) {
    if (finishMs(remaining, itemMs, spawnMs, k) <= target) return k
  }
  return fanout
}

export function planSplit(
  next: number,
  hi: number,
  k: number,
  itemMs: number,
  spawnMs: number,
): { cut: number; children: Range[] } | null {
  const remaining = hi - next
  const count = Math.min(k, remaining - 1)
  if (count < 1) return null
  const ideal = (remaining + (count * spawnMs) / itemMs) / (count + 1)
  const keep = Math.min(remaining - count, Math.max(1, Math.round(ideal)))
  const given = remaining - keep
  const cut = next + keep
  const children: Range[] = []
  let lo = cut
  for (let i = 0; i < count; i++) {
    const size = Math.floor(given / count) + (i < given % count ? 1 : 0)
    children.push({ lo, hi: lo + size })
    lo += size
  }
  return { cut, children }
}
