import type { ExhibitDetail, ExhibitStats } from './exhibits.ts'
import { isRecord } from './records.ts'

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

export type ExhibitRun = Pick<ExhibitDetail, 'id' | 'policy' | 'params' | 'tasks'> & { stats: ExhibitStats }

const itemCostFields: { [F in keyof ItemCostSample]: ItemCostSample[F] extends number ? 'number' : 'string' } = {
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

function isItemCostSample(value: unknown): value is ItemCostSample {
  return isRecord(value) && Object.entries(itemCostFields).every(([field, type]) => typeof value[field] === type)
}

export function parseItemCosts(text: string, origin: string): ItemCostSample[] {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`${origin} is not valid JSON`)
  }
  if (!isRecord(json) || !Array.isArray(json.samples)) throw new Error(`${origin} lists no samples`)
  return json.samples.map((sample: unknown, index) => {
    if (!isItemCostSample(sample)) throw new Error(`${origin}: sample ${index} is not an item cost sample`)
    return sample
  })
}
