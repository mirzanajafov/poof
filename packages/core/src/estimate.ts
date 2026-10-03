import type { Estimate } from './types.ts'

export const emptyEstimate: Estimate = { mean: 0, variance: 0, count: 0 }

export function updateEstimate(estimate: Estimate, sample: number, alpha = 0.2): Estimate {
  if (estimate.count === 0) return { mean: sample, variance: 0, count: 1 }
  const diff = sample - estimate.mean
  const step = alpha * diff
  return {
    mean: estimate.mean + step,
    variance: (1 - alpha) * (estimate.variance + diff * step),
    count: estimate.count + 1,
  }
}

export interface WorkRatio {
  actual: number
  predicted: number
  items: number
}

export const emptyWorkRatio: WorkRatio = { actual: 0, predicted: 0, items: 0 }

export function priorWorkRatio(ratio: number, predictedMs: number, minItems = 5): WorkRatio {
  return { actual: ratio * predictedMs, predicted: predictedMs, items: minItems }
}

export function updateWorkRatio(ratio: WorkRatio, actual: number, predicted: number, window = 200): WorkRatio {
  const keep = 1 - 1 / window
  return { actual: ratio.actual * keep + actual, predicted: ratio.predicted * keep + predicted, items: ratio.items + 1 }
}

export function workRatio(ratio: WorkRatio, fallback = 1, minItems = 5): number {
  return ratio.items >= minItems && ratio.predicted > 0 ? ratio.actual / ratio.predicted : fallback
}

export function upperMean(estimate: Estimate, z: number, alpha = 0.2): number {
  if (z === 0 || estimate.count < 2) return estimate.mean
  const effective = Math.min(estimate.count, (2 - alpha) / alpha)
  return estimate.mean + z * Math.sqrt(estimate.variance / effective)
}
