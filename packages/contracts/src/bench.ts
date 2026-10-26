import type { ExhibitDetail, ExhibitStats } from './exhibits.ts'
import { isRecord, parseJson } from './records.ts'

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

export interface ConcurrencyRow {
  k: number
  items: number
  effectiveCores: number
  efficiency: number
  wallInflation: number
  peakRssMb: number
  medianPeakRssMb: number
  cgroupAnonMeanMb: number | null
  cgroupAnonPeakMb: number | null
}

export interface ConcurrencyRun {
  cpus: number
  knee: number
  rows: ConcurrencyRow[]
}

export interface Summary {
  n: number
  mean: number
  p50: number
  p95: number
  p99: number
  max: number
}

export interface SpawnRun {
  warm: { wallMs: Summary; cpuMs: Summary; rssMb: Summary; anonMb: Summary | null }
}

export type ExhibitRun = Pick<ExhibitDetail, 'id' | 'policy' | 'params' | 'tasks'> & { stats: ExhibitStats }

type FieldType = 'number' | 'string' | 'number or null'

type Fields<T> = { [F in keyof T]: T[F] extends number ? 'number' : T[F] extends string ? 'string' : 'number or null' }

const itemCostFields: Fields<ItemCostSample> = {
  source: 'string',
  file: 'string',
  mp: 'number',
  bytes: 'number',
  preset: 'string',
  pass: 'number',
  readMs: 'number',
  wallMs: 'number',
  cpuMs: 'number',
  peakRssMb: 'number',
  outBytes: 'number',
}

const concurrencyRowFields: Fields<ConcurrencyRow> = {
  k: 'number',
  items: 'number',
  effectiveCores: 'number',
  efficiency: 'number',
  wallInflation: 'number',
  peakRssMb: 'number',
  medianPeakRssMb: 'number',
  cgroupAnonMeanMb: 'number or null',
  cgroupAnonPeakMb: 'number or null',
}

const summaryFields: Fields<Summary> = {
  n: 'number',
  mean: 'number',
  p50: 'number',
  p95: 'number',
  p99: 'number',
  max: 'number',
}

function fits(value: unknown, type: FieldType): boolean {
  return type === 'number or null' ? value === null || typeof value === 'number' : typeof value === type
}

function hasFields<T>(value: unknown, fields: Fields<T>): value is T {
  return isRecord(value) && Object.entries<FieldType>(fields).every(([field, type]) => fits(value[field], type))
}

function entries<T>(json: unknown, key: string, fields: Fields<T>, origin: string): T[] {
  const list = isRecord(json) ? json[key] : undefined
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${origin} lists no ${key}`)
  return list.map((entry: unknown, index) => {
    if (!hasFields(entry, fields))
      throw new Error(`${origin}: ${key} entry ${index} misses a field or has a wrong type`)
    return entry
  })
}

export function parseItemCosts(text: string, origin: string): ItemCostSample[] {
  return entries(parseJson(text, origin), 'samples', itemCostFields, origin)
}

export function parseConcurrencyRun(text: string, origin: string): ConcurrencyRun {
  const json = parseJson(text, origin)
  const rows = entries(json, 'rows', concurrencyRowFields, origin)
  if (!hasFields<Omit<ConcurrencyRun, 'rows'>>(json, { cpus: 'number', knee: 'number' })) {
    throw new Error(`${origin} needs a number of cpus and a knee`)
  }
  return { cpus: json.cpus, knee: json.knee, rows }
}

function isSummary(value: unknown): value is Summary {
  return hasFields(value, summaryFields)
}

export function parseSpawnRun(text: string, origin: string): SpawnRun {
  const json = parseJson(text, origin)
  const warm = isRecord(json) ? json.warm : undefined
  if (!isRecord(warm) || !isSummary(warm.wallMs) || !isSummary(warm.cpuMs) || !isSummary(warm.rssMb)) {
    throw new Error(`${origin} needs summaries of the warm spawns' wall time, CPU time and memory`)
  }
  const anonMb = warm.anonMb ?? null
  if (anonMb !== null && !isSummary(anonMb))
    throw new Error(`${origin} has an anonymous memory summary that is not one`)
  return { warm: { wallMs: warm.wallMs, cpuMs: warm.cpuMs, rssMb: warm.rssMb, anonMb } }
}
