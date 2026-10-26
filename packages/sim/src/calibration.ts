import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  concurrencyResultPrefix,
  itemCostsResult,
  parseConcurrencyRun,
  parseItemCosts,
  parseSpawnRun,
  spawnResult,
  type ConcurrencyRun,
  type ItemCost,
} from '@poof/contracts/bench'
import { valueAt, type CostModel } from '@poof/core'
import { linearFit, powerFit, quantile } from '@poof/core/stats'

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
  memoryRampItems: number
  curves: Curve[]
}

const defaultResultsDir = fileURLToPath(new URL('../../../bench/results/', import.meta.url))

function readResult<T>(dir: string, name: string, parse: (text: string, origin: string) => T): T {
  const path = join(dir, `${name}.json`)
  return parse(readFileSync(path, 'utf8'), path)
}

export function itemCostSamples(label: string, dir = defaultResultsDir): ItemCost[] {
  return readResult(join(dir, label), itemCostsResult, parseItemCosts)
}

function typeCosts(samples: readonly ItemCost[], sources: readonly string[]): Record<string, CostModel> {
  const byImage = new Map<string, { preset: string; mp: number; walls: number[] }>()
  for (const s of samples) {
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
  const b3 = readResult(base, spawnResult, parseSpawnRun)
  const b2s = mergeByCpus(
    readdirSync(base)
      .filter((file) => file.startsWith(concurrencyResultPrefix))
      .map((file) => readResult(base, file.replace(/\.json$/, ''), parseConcurrencyRun)),
  )
  const measured = b2s.flatMap((b2) =>
    b2.rows.flatMap(({ k, cgroupAnonPeakMb }) =>
      k <= Math.ceil(3 * b2.cpus) && cgroupAnonPeakMb !== null ? [{ k, anonMb: cgroupAnonPeakMb }] : [],
    ),
  )
  const steadyRssMb =
    measured.length >= 3
      ? linearFit(
          measured.map((r) => r.k),
          measured.map((r) => r.anonMb),
        ).slope
      : quantile(
          b2s.flatMap((b2) => b2.rows.map((r) => r.medianPeakRssMb)),
          0.5,
        )
  return {
    label,
    types: typeCosts(itemCostSamples(label, dir), sources),
    spawnMs: b3.warm.wallMs.p50,
    spawnCpuMs: b3.warm.cpuMs.p50,
    baseRssMb: b3.warm.anonMb?.p50 ?? b3.warm.rssMb.p50,
    steadyRssMb,
    memoryRampItems: 100,
    curves: b2s.map((b2) => ({
      cpus: b2.cpus,
      knee: b2.knee,
      points: b2.rows.map((r) => ({ workers: r.k, effectiveCores: Math.min(r.effectiveCores, r.k, b2.cpus) })),
    })),
  }
}

function mergeByCpus(files: ConcurrencyRun[]): ConcurrencyRun[] {
  const byCpus = new Map<number, ConcurrencyRun>()
  for (const file of [...files].sort((a, b) => valueAt(a.rows, 0).k - valueAt(b.rows, 0).k)) {
    const known = byCpus.get(file.cpus)
    if (!known) {
      byCpus.set(file.cpus, { ...file, rows: [...file.rows] })
      continue
    }
    for (const row of file.rows) if (!known.rows.some((r) => r.k === row.k)) known.rows.push(row)
    known.rows.sort((a, b) => a.k - b.k)
  }
  return [...byCpus.values()].sort((a, b) => a.cpus - b.cpus)
}

export interface FittedCurve extends Curve {
  decline: number
}

export function nearestCurve(calibration: Calibration, cpus: number): Curve {
  let best = valueAt(calibration.curves, 0)
  for (const curve of calibration.curves) {
    if (Math.abs(curve.cpus - cpus) < Math.abs(best.cpus - cpus)) best = curve
  }
  return best
}

export function curveFor(calibration: Calibration, cpus: number): FittedCurve {
  const curve = nearestCurve(calibration, cpus)
  return { ...curve, decline: decline(curve) }
}

function decline(curve: Curve): number {
  const saturated = curve.points.filter((p) => p.workers >= Math.ceil(curve.cpus))
  if (saturated.length < 2) return 0
  const { slope } = linearFit(
    saturated.map((p) => p.workers),
    saturated.map((p) => p.effectiveCores),
  )
  return slope < 0 ? slope : 0
}

function onCurve(curve: FittedCurve, workers: number): number {
  const points = curve.points
  const first = valueAt(points, 0)
  const last = valueAt(points, points.length - 1)
  if (workers <= first.workers) return (first.effectiveCores * workers) / first.workers
  if (workers <= last.workers) {
    const hi = points.findIndex((p) => p.workers >= workers)
    const a = valueAt(points, hi - 1)
    const b = valueAt(points, hi)
    const t = (workers - a.workers) / (b.workers - a.workers)
    return a.effectiveCores + t * (b.effectiveCores - a.effectiveCores)
  }
  return Math.max(0.25 * last.effectiveCores, last.effectiveCores + curve.decline * (workers - last.workers))
}

export function effectiveCores(curve: FittedCurve, workers: number, cpus: number): number {
  if (workers <= 0) return 0
  const scale = cpus / curve.cpus
  return onCurve(curve, workers / scale) * scale
}
