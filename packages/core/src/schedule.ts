import { Rng } from './rng.ts'

export interface ScheduleParams {
  durationMs: number
  utilization: number
  capacityCores: number
  minItems: number
  maxItems: number
  slackMin: number
  slackMax: number
  seed: number
}

export interface Arrival {
  at: number
  offset: number
  count: number
  slack: number
}

export function exhibitSchedule(params: ScheduleParams, itemMs: readonly number[]): Arrival[] {
  const rng = new Rng(params.seed)
  const meanItemMs = itemMs.reduce((sum, v) => sum + v, 0) / itemMs.length
  const meanItems =
    params.maxItems > params.minItems
      ? (params.maxItems - params.minItems) / Math.log(params.maxItems / params.minItems)
      : params.minItems
  const rate = (params.utilization * params.capacityCores) / (meanItems * meanItemMs)
  const arrivals: Arrival[] = []
  for (let at = 0; at < params.durationMs; at += rng.exponential(rate)) {
    arrivals.push({
      at,
      count: Math.round(rng.logUniform(params.minItems, params.maxItems)),
      offset: rng.int(0, itemMs.length - 1),
      slack: rng.logUniform(params.slackMin, params.slackMax),
    })
  }
  return arrivals
}
