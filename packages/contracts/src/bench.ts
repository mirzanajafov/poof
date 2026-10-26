import type { ExhibitDetail, ExhibitParams, ExhibitStats } from './exhibits.ts'

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

export interface ExhibitRun {
  id: string
  policy: ExhibitParams['policy']
  params: ExhibitParams
  stats: ExhibitStats
  tasks: ExhibitDetail['tasks']
}
