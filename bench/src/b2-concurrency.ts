import { fork, type ChildProcess } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadDataset } from './dataset.ts'
import { cgroupAnonMb } from './memory.ts'
import { environment, readResult, writeResult } from './results.ts'
import { mean, median, round } from './stats.ts'

const { values } = parseArgs({
  options: {
    data: { type: 'string', default: 'data/synthetic' },
    preset: { type: 'string', default: 'webp-1600' },
    cpus: { type: 'string' },
    'k-max': { type: 'string' },
    ks: { type: 'string' },
    write: { type: 'boolean', default: false },
    duration: { type: 'string', default: '15' },
    warmup: { type: 'string', default: '3' },
    label: { type: 'string', default: 'local' },
    name: { type: 'string' },
  },
})

interface B1 {
  samples: Array<{ source: string; file: string; preset: string; wallMs: number }>
}

interface Done {
  type: 'done'
  completions: Array<{ file: string; at: number; wallMs: number }>
  cpuMs: number
  peakRssMb: number
}

const cpus = Number(values.cpus ?? process.env.CPU_LIMIT ?? availableParallelism())
const kMax = Number(values['k-max'] ?? Math.ceil(3 * cpus))
const durationMs = Number(values.duration) * 1000
const warmupMs = Number(values.warmup) * 1000
const dataset = await loadDataset(values.data!)
const b1 = await readResult<B1>(values.label!, 'b1-item-cost')

const costs = new Map<string, number[]>()
for (const s of b1.samples) {
  if (s.preset !== values.preset || s.source !== dataset.source) continue
  costs.set(s.file, [...(costs.get(s.file) ?? []), s.wallMs])
}
const cost = new Map([...costs].map(([file, walls]) => [file, median(walls)]))

const childPath = fileURLToPath(new URL('./b2-child.js', import.meta.url))

function nextMessage<T>(child: ChildProcess, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const onExit = (code: number | null) => reject(new Error(`child exited with ${code} before ${type}`))
    const onMessage = (message: { type: string }) => {
      if (message.type !== type) return
      child.off('message', onMessage)
      child.off('exit', onExit)
      resolve(message as T)
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
  })
}

const rows = []
const ks = values.ks ? values.ks.split(',').map(Number) : Array.from({ length: kMax }, (_, i) => i + 1)
for (const k of ks) {
  const children = Array.from({ length: k }, (_, i) =>
    fork(childPath, ['--data', values.data!, '--preset', values.preset!, '--seed', String(100 + i), ...(values.write ? ['--write'] : [])]),
  )
  await Promise.all(children.map((child) => nextMessage(child, 'ready')))
  const goAt = Date.now()
  const done = children.map((child) => nextMessage<Done>(child, 'done'))
  for (const child of children) child.send({ type: 'go' })
  await sleep(warmupMs)
  const anon: number[] = []
  const sampler = setInterval(() => {
    const value = cgroupAnonMb()
    if (value !== null) anon.push(value)
  }, 200)
  await sleep(durationMs)
  clearInterval(sampler)
  for (const child of children) child.send({ type: 'stop' })
  const results = await Promise.all(done)

  const from = goAt + warmupMs
  const to = from + durationMs
  const window = results.flatMap((r) => r.completions).filter((c) => c.at >= from && c.at < to)
  const workMs = window.reduce((sum, c) => sum + (cost.get(c.file) ?? 0), 0)
  const effectiveCores = workMs / durationMs
  const row = {
    k,
    items: window.length,
    effectiveCores: round(effectiveCores),
    efficiency: round(effectiveCores / Math.min(k, cpus)),
    wallInflation: round(mean(window.map((c) => c.wallMs / (cost.get(c.file) ?? c.wallMs)))),
    peakRssMb: round(Math.max(...results.map((r) => r.peakRssMb))),
    medianPeakRssMb: round(median(results.map((r) => r.peakRssMb))),
    cgroupAnonMeanMb: anon.length ? round(mean(anon)) : null,
    cgroupAnonPeakMb: anon.length ? round(Math.max(...anon)) : null,
  }
  rows.push(row)
  console.log(JSON.stringify(row))
}

let knee = rows.length
for (let i = 0; i + 1 < rows.length; i++) {
  if (rows[i + 1]!.effectiveCores < rows[i]!.effectiveCores * 1.05) {
    knee = rows[i]!.k
    break
  }
}

const name = values.name ?? `b2-concurrency-c${cpus}`
const path = await writeResult(values.label!, name, {
  env: environment(values.label!),
  cpus,
  preset: values.preset,
  source: dataset.source,
  durationMs,
  warmupMs,
  mallocArenaMax: process.env.MALLOC_ARENA_MAX ?? null,
  writesOutputs: values.write,
  knee,
  rows,
})
console.log(`knee at k=${knee}, wrote ${path}`)
