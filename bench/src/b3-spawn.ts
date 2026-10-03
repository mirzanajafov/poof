import { fork } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { environment, writeResult } from './results.ts'
import { round, summary } from './stats.ts'

const { values } = parseArgs({
  options: {
    reps: { type: 'string', default: '30' },
    label: { type: 'string', default: 'local' },
  },
})

interface Ready {
  sinceStartMs: number
  importMs: number
  cpuMs: number
  rssMb: number
  anonMb: number | null
}

type Run = Ready & { wallMs: number; exitMs: number }

const childPath = fileURLToPath(new URL('./b3-child.js', import.meta.url))
const runs: Run[] = []
for (let i = 0; i < Number(values.reps); i++) {
  const started = performance.now()
  const child = fork(childPath)
  const [ready] = (await once(child, 'message')) as [Ready]
  const wallMs = performance.now() - started
  const exitStarted = performance.now()
  child.send('exit')
  await once(child, 'exit')
  runs.push({ ...ready, wallMs, exitMs: performance.now() - exitStarted })
}

const warm = runs.slice(1)
const describe = (values: number[]) =>
  Object.fromEntries(Object.entries(summary(values)).map(([k, v]) => [k, round(v, 1)]))
const pick = (key: Exclude<keyof Run, 'anonMb'>) => describe(warm.map((r) => r[key]))
const anon = warm.map((r) => r.anonMb).filter((v): v is number => v !== null)

const result = {
  env: environment(values.label!),
  first: runs[0],
  warm: {
    wallMs: pick('wallMs'),
    sinceStartMs: pick('sinceStartMs'),
    importMs: pick('importMs'),
    cpuMs: pick('cpuMs'),
    rssMb: pick('rssMb'),
    anonMb: anon.length === warm.length ? describe(anon) : null,
    exitMs: pick('exitMs'),
  },
}
console.log(JSON.stringify(result.warm, null, 2))
console.log(`wrote ${await writeResult(values.label!, 'b3-spawn', result)}`)
