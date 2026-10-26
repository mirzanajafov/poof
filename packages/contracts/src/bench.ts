import { exhibitPolicyNames, presetNames } from '@poof/core'
import { median } from '@poof/core/stats'
import type { ExhibitDetail, ExhibitParams, ExhibitStats } from './exhibits.ts'
import { assertFields, hasFields, isRecord, parseJson, type Checks } from './records.ts'

export const itemCostsResult = 'b1-item-cost'
export const concurrencyResultPrefix = 'b2-concurrency-c'
export const spawnResult = 'b3-spawn'

export interface ItemCostSample {
  source: string
  file: string
  mp: number
  bytes: number
  preset: string
  pass: number
  readMs: number
  wallMs: number
  cpuMs: number
  peakRssMb: number
  outBytes: number
}

export type ItemCost = Pick<ItemCostSample, 'source' | 'file' | 'preset' | 'mp' | 'wallMs'>

export interface ConcurrencyRow {
  k: number
  items: number
  effectiveCores: number
  efficiency: number
  wallInflation: number | null
  peakRssMb: number
  medianPeakRssMb: number
  cgroupAnonMeanMb: number | null
  cgroupAnonPeakMb: number | null
}

export type ConcurrencyPoint = Pick<ConcurrencyRow, 'k' | 'effectiveCores' | 'medianPeakRssMb' | 'cgroupAnonPeakMb'>

export interface ConcurrencyRun {
  cpus: number
  knee: number
  rows: ConcurrencyPoint[]
}

export interface Median {
  p50: number
}

export interface SpawnRun {
  warm: { wallMs: Median; cpuMs: Median; rssMb: Median; anonMb: Median | null }
}

export type ExhibitRun = Pick<ExhibitDetail, 'id' | 'policy' | 'params' | 'tasks'> & { stats: ExhibitStats }

export type ExhibitRunStats = Pick<
  ExhibitStats,
  'submitted' | 'rejected' | 'met' | 'peakProcesses' | 'spawns' | 'items' | 'exits'
>

export interface ExhibitRunSummary {
  id: string
  params: ExhibitParams
  stats: ExhibitRunStats
}

const itemCostChecks: Checks<ItemCost> = {
  source: 'string',
  file: 'string',
  preset: 'string',
  mp: 'number',
  wallMs: 'number',
}

const concurrencyPointChecks: Checks<ConcurrencyPoint> = {
  k: 'number',
  effectiveCores: 'number',
  medianPeakRssMb: 'number',
  cgroupAnonPeakMb: 'number or null',
}

const medianChecks: Checks<Median> = { p50: 'number' }

const exhibitParamChecks: Checks<ExhibitParams> = {
  policy: exhibitPolicyNames,
  durationSeconds: 'number',
  utilization: 'number',
  dataset: 'string',
  preset: presetNames,
  minItems: 'number',
  maxItems: 'number',
  slackMin: 'number',
  slackMax: 'number',
  seed: 'number',
}

const exhibitRunStatsChecks: Checks<ExhibitRunStats> = {
  submitted: 'number',
  rejected: 'number',
  met: 'number',
  peakProcesses: 'number',
  spawns: 'number',
  items: 'number',
  exits: 'object',
}

function entries<T>(list: unknown, checks: Checks<T>, what: string, origin: string): T[] {
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${origin} lists no ${what}`)
  return list.map((entry: unknown, index) => {
    assertFields<T>(entry, checks, `${origin}: ${what} ${index}`)
    return entry
  })
}

export function parseItemCosts(text: string, origin: string): ItemCost[] {
  const json = parseJson(text, origin)
  return entries<ItemCost>(isRecord(json) ? json.samples : undefined, itemCostChecks, 'samples', origin)
}

export function itemCostMedians(costs: readonly ItemCost[], preset: string, source: string): Map<string, number> {
  const walls = new Map<string, number[]>()
  for (const cost of costs) {
    if (cost.preset !== preset || cost.source !== source) continue
    walls.set(cost.file, [...(walls.get(cost.file) ?? []), cost.wallMs])
  }
  return new Map([...walls].map(([file, ms]) => [file, median(ms)]))
}

export function parseConcurrencyRun(text: string, origin: string): ConcurrencyRun {
  const json = parseJson(text, origin)
  const rows = entries<ConcurrencyPoint>(isRecord(json) ? json.rows : undefined, concurrencyPointChecks, 'rows', origin)
  assertFields<Omit<ConcurrencyRun, 'rows'>>(json, { cpus: 'number', knee: 'number' }, origin)
  return { cpus: json.cpus, knee: json.knee, rows }
}

export function parseSpawnRun(text: string, origin: string): SpawnRun {
  const json = parseJson(text, origin)
  const warm = isRecord(json) ? json.warm : undefined
  const isMedian = (value: unknown): value is Median => hasFields<Median>(value, medianChecks)
  if (!isRecord(warm) || !isMedian(warm.wallMs) || !isMedian(warm.cpuMs) || !isMedian(warm.rssMb)) {
    throw new Error(`${origin} needs the median wall time, CPU time and memory of the warm spawns`)
  }
  const anonMb = warm.anonMb ?? null
  if (anonMb !== null && !isMedian(anonMb))
    throw new Error(`${origin} has an anonymous memory summary without a median`)
  return { warm: { wallMs: warm.wallMs, cpuMs: warm.cpuMs, rssMb: warm.rssMb, anonMb } }
}

export function exhibitRunSummary(run: unknown, origin: string): ExhibitRunSummary {
  assertFields<{ id: string; params: object; stats: object }>(
    run,
    { id: 'string', params: 'object', stats: 'object' },
    origin,
  )
  const { id, params, stats } = run
  assertFields<ExhibitParams>(params, exhibitParamChecks, `${origin}: run ${id} params`)
  assertFields<ExhibitRunStats>(stats, exhibitRunStatsChecks, `${origin}: run ${id} stats`)
  if (!Object.values<unknown>(stats.exits).every((count) => typeof count === 'number')) {
    throw new Error(`${origin}: run ${id} stats has exit counts that are not numbers`)
  }
  return { id, params, stats }
}

export function parseExhibitRuns(text: string, origin: string): ExhibitRunSummary[] {
  const runs = parseJson(text, origin)
  if (!Array.isArray(runs) || runs.length === 0) throw new Error(`${origin} lists no runs`)
  return runs.map((run: unknown) => exhibitRunSummary(run, origin))
}
