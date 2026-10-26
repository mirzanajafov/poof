import { valueAt } from './lookup.ts'
import { Rng } from './rng.ts'

export interface Interval {
  mean: number
  lo: number
  hi: number
}

export interface LinearFit {
  intercept: number
  slope: number
  r2: number
  logResidualSd: number
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const lo = valueAt(sorted, Math.floor(pos))
  const hi = valueAt(sorted, Math.ceil(pos))
  return lo + (hi - lo) * (pos - Math.floor(pos))
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5)
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : values.reduce((sum, v) => sum + v, 0) / values.length
}

export function stdev(values: readonly number[]): number {
  const m = mean(values)
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1))
}

export function linearFit(xs: readonly number[], ys: readonly number[]): LinearFit {
  if (xs.length !== ys.length) throw new RangeError(`${xs.length} xs against ${ys.length} ys`)
  const mx = mean(xs)
  const my = mean(ys)
  let sxy = 0
  let sxx = 0
  xs.forEach((x, i) => {
    sxy += (x - mx) * (valueAt(ys, i) - my)
    sxx += (x - mx) ** 2
  })
  const slope = sxy / sxx
  const intercept = my - slope * mx
  let ssRes = 0
  let ssTot = 0
  const logResiduals: number[] = []
  xs.forEach((x, i) => {
    const y = valueAt(ys, i)
    const predicted = intercept + slope * x
    ssRes += (y - predicted) ** 2
    ssTot += (y - my) ** 2
    const logResidual = Math.log(y / predicted)
    if (Number.isFinite(logResidual)) logResiduals.push(logResidual)
  })
  return { intercept, slope, r2: 1 - ssRes / ssTot, logResidualSd: stdev(logResiduals) }
}

export function powerFit(xs: readonly number[], ys: readonly number[]) {
  const lx = xs.map(Math.log)
  const ly = ys.map(Math.log)
  const fit = linearFit(lx, ly)
  const residuals = lx.map((x, i) => valueAt(ly, i) - (fit.intercept + fit.slope * x))
  return { coef: Math.exp(fit.intercept), exponent: fit.slope, logResidualSd: stdev(residuals) }
}

export function bootstrap(values: readonly number[], seed = 1, resamples = 2000): Interval {
  const rng = new Rng(seed)
  const n = values.length
  const means: number[] = []
  for (let r = 0; r < resamples; r++) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += valueAt(values, Math.floor(rng.next() * n))
    means.push(sum / n)
  }
  return { mean: mean(values), lo: quantile(means, 0.025), hi: quantile(means, 0.975) }
}

export function summary(values: readonly number[]) {
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
