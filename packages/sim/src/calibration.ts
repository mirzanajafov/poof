import type { CostModel } from '@poof/core'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { linearFit, powerFit, quantile } from './stats.ts'

export interface Curve {
  cpus: number
  knee: number
  points: Array<{ workers: number; effectiveCores: number }>
}

export interface Calibration {
  label: string
  types: Record<string, CostModel>
  spawnMs: number
  spawnCpuMs: number
  baseRssMb: number
  steadyRssMb: number
  curves: Curve[]
}

interface B1 {
  samples: Array<{ source: string; file: string; preset: string; mp: number; wallMs: number; peakRssMb: number }>
}

interface B2 {
  cpus: number
  knee: number
  rows: Array<{ k: number; effectiveCores: number; medianPeakRssMb: number; cgroupAnonPeakMb?: number | null }>
}

interface B3 {
  warm: { wallMs: { p50: number }; cpuMs: { p50: number }; rssMb: { p50: number }; anonMb?: { p50: number } | null }
}

export const defaultResultsDir = fileURLToPath(new URL('../../../bench/results/', import.meta.url))

function read<T>(dir: string, name: string): T {
  return JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as T
}

function typeCosts(b1: B1, sources: readonly string[]): Record<string, CostModel> {
  const byImage = new Map<string, { preset: string; mp: number; walls: number[] }>()
  for (const s of b1.samples) {
    if (!sources.includes(s.source)) continue
    const key = `${s.preset}|${s.source}|${s.file}`
    const entry = byImage.get(key) ?? { preset: s.preset, mp: s.mp, walls: [] }
    entry.walls.push(s.wallMs)
    byImage.set(key, entry)
  }
  const types: Record<string, CostModel> = {}
  for (const preset of new Set([...byImage.values()].map((e) => e.preset))) {
    const images = [...byImage.values()].filter((e) => e.preset === preset)
    const fit = powerFit(
      images.map((e) => e.mp),
      images.map((e) => quantile(e.walls, 0.5)),
    )
    types[preset] = { coefMs: fit.coef, exponent: fit.exponent, logResidualSd: fit.logResidualSd }
  }
  return types
}

export function loadCalibration(label: string, dir = defaultResultsDir, sources = ['synthetic', 'nasa']): Calibration {
  const base = join(dir, label)
  if (!existsSync(base)) throw new Error(`no calibration results in ${base}`)
  const b1 = read<B1>(base, 'b1-item-cost')
  const b3 = read<B3>(base, 'b3-spawn')
  const b2s = readdirSync(base)
    .filter((file) => file.startsWith('b2-concurrency-c'))
    .map((file) => read<B2>(base, file.replace(/\.json$/, '')))
    .sort((a, b) => a.cpus - b.cpus)
  const measured = b2s.flatMap((b2) => b2.rows.filter((r) => r.cgroupAnonPeakMb !== null && r.cgroupAnonPeakMb !== undefined))
  const steadyRssMb =
    measured.length >= 3
      ? linearFit(
          measured.map((r) => r.k),
          measured.map((r) => r.cgroupAnonPeakMb!),
        ).slope
      : quantile(
          b2s.flatMap((b2) => b2.rows.map((r) => r.medianPeakRssMb)),
          0.5,
        )
  return {
    label,
    types: typeCosts(b1, sources),
    spawnMs: b3.warm.wallMs.p50,
    spawnCpuMs: b3.warm.cpuMs.p50,
    baseRssMb: b3.warm.anonMb?.p50 ?? b3.warm.rssMb.p50,
    steadyRssMb,
    curves: b2s.map((b2) => ({
      cpus: b2.cpus,
      knee: b2.knee,
      points: b2.rows.map((r) => ({ workers: r.k, effectiveCores: Math.min(r.effectiveCores, r.k, b2.cpus) })),
    })),
  }
}

export function curveFor(calibration: Calibration, cpus: number): Curve {
  let best = calibration.curves[0]!
  for (const curve of calibration.curves) {
    if (Math.abs(curve.cpus - cpus) < Math.abs(best.cpus - cpus)) best = curve
  }
  return best
}

function onCurve(curve: Curve, workers: number): number {
  const points = curve.points
  const first = points[0]!
  const last = points[points.length - 1]!
  if (workers <= first.workers) return (first.effectiveCores * workers) / first.workers
  if (workers <= last.workers) {
    const hi = points.findIndex((p) => p.workers >= workers)
    const a = points[hi - 1]!
    const b = points[hi]!
    const t = (workers - a.workers) / (b.workers - a.workers)
    return a.effectiveCores + t * (b.effectiveCores - a.effectiveCores)
  }
  const saturated = points.filter((p) => p.workers >= Math.ceil(curve.cpus))
  const fit =
    saturated.length >= 2
      ? linearFit(
          saturated.map((p) => p.workers),
          saturated.map((p) => p.effectiveCores),
        )
      : null
  const decline = fit && fit.slope < 0 ? fit.slope : 0
  return Math.max(0.25 * last.effectiveCores, last.effectiveCores + decline * (workers - last.workers))
}

export function effectiveCores(curve: Curve, workers: number, cpus: number): number {
  if (workers <= 0) return 0
  const scale = cpus / curve.cpus
  return onCurve(curve, workers / scale) * scale
}
