import { Rng } from './rng.ts'

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : values.reduce((sum, v) => sum + v, 0) / values.length
}

export function linearFit(xs: readonly number[], ys: readonly number[]) {
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
  const logResiduals = xs
    .map((x, i) => Math.log(ys[i]! / (intercept + slope * x)))
    .filter((r) => Number.isFinite(r))
  const m = mean(logResiduals)
  const sd = Math.sqrt(logResiduals.reduce((sum, r) => sum + (r - m) ** 2, 0) / (logResiduals.length - 1))
  return { intercept, slope, logResidualSd: sd }
}

export interface Interval {
  mean: number
  lo: number
  hi: number
}

export function bootstrap(values: readonly number[], seed = 1, resamples = 2000): Interval {
  const rng = new Rng(seed)
  const means: number[] = []
  for (let r = 0; r < resamples; r++) {
    let sum = 0
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(rng.next() * values.length)]!
    means.push(sum / values.length)
  }
  return { mean: mean(values), lo: quantile(means, 0.025), hi: quantile(means, 0.975) }
}

export function powerFit(xs: readonly number[], ys: readonly number[]) {
  const lx = xs.map(Math.log)
  const ly = ys.map(Math.log)
  const fit = linearFit(lx, ly)
  const residuals = lx.map((x, i) => ly[i]! - (fit.intercept + fit.slope * x))
  const m = mean(residuals)
  const sd = Math.sqrt(residuals.reduce((sum, r) => sum + (r - m) ** 2, 0) / (residuals.length - 1))
  return { coef: Math.exp(fit.intercept), exponent: fit.slope, logResidualSd: sd }
}
