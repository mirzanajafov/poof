import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { configureSharp, presetByName, processItem } from '@poof/imaging'
import { itemPath, loadDataset, shuffled } from './dataset.ts'
import { cgroupAnonMb, rssMb } from './memory.ts'
import { environment, writeResult } from './results.ts'
import { round } from './stats.ts'

const { values } = parseArgs({
  options: {
    data: { type: 'string', default: 'data/synthetic' },
    preset: { type: 'string', default: 'webp-1600' },
    items: { type: 'string', default: '1500' },
    every: { type: 'string', default: '25' },
    label: { type: 'string', default: 'local' },
    name: { type: 'string', default: 'b5-memory-growth' },
  },
})

configureSharp()
const preset = presetByName(values.preset!)
const dataset = await loadDataset(values.data!)
const order = shuffled(dataset.items, 5)
const total = Number(values.items)
const every = Number(values.every)
const samples = [{ items: 0, rssMb: round(rssMb()), anonMb: cgroupAnonMb() }]
const started = performance.now()
for (let i = 1; i <= total; i++) {
  const item = order[(i - 1) % order.length]!
  await processItem(await readFile(itemPath(dataset, item)), preset)
  if (i % every === 0) {
    const anon = cgroupAnonMb()
    samples.push({ items: i, rssMb: round(rssMb()), anonMb: anon === null ? null : round(anon) })
  }
}

const path = await writeResult(values.label!, values.name!, {
  env: { ...environment(values.label!), mallocArenaMax: process.env.MALLOC_ARENA_MAX ?? null },
  preset: values.preset,
  seconds: round((performance.now() - started) / 1000, 1),
  samples,
})
console.log(JSON.stringify(samples.filter((_, i) => i % 6 === 0)))
console.log(`wrote ${path}`)
