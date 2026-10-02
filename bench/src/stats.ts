export function quantile(values: number[], q: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
}

export function median(values: number[]): number {
  return quantile(values, 0.5)
}

export function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export function stdev(values: number[]): number {
  const m = mean(values)
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1))
}

export interface LinearFit {
  intercept: number
  slope: number
  r2: number
  logResidualSd: number
}

export function linearFit(xs: number[], ys: number[]): LinearFit {
  const mx = mean(xs)
  const my = mean(ys)
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my)
    sxx += (xs[i]! - mx) ** 2
  }
  const slope = sxy / sxx
  const intercept = my - slope * mx
  let ssRes = 0
  let ssTot = 0
  const logResiduals: number[] = []
  for (let i = 0; i < xs.length; i++) {
    const predicted = intercept + slope * xs[i]!
    ssRes += (ys[i]! - predicted) ** 2
    ssTot += (ys[i]! - my) ** 2
    if (predicted > 0 && ys[i]! > 0) logResiduals.push(Math.log(ys[i]! / predicted))
  }
  return { intercept, slope, r2: 1 - ssRes / ssTot, logResidualSd: stdev(logResiduals) }
}

export function summary(values: number[]) {
  return {
    n: values.length,
    mean: mean(values),
    p50: quantile(values, 0.5),
    p95: quantile(values, 0.95),
    p99: quantile(values, 0.99),
    max: Math.max(...values),
  }
}

export function round(value: number, digits = 3): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}
