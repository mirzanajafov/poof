import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { configureSharp, presetByName, processItem } from '@poof/imaging'
import { itemPath, loadDataset, shuffled } from './dataset.ts'
import { peakRssMb, rssMb } from './memory.ts'

const { values } = parseArgs({
  options: {
    data: { type: 'string', default: 'data/synthetic' },
    preset: { type: 'string', default: 'webp-1600' },
    seed: { type: 'string', default: '1' },
  },
})

configureSharp()
const preset = presetByName(values.preset!)
const dataset = await loadDataset(values.data!)
const order = shuffled(dataset.items, Number(values.seed))
const completions: Array<{ file: string; at: number; wallMs: number }> = []
let stopped = false

async function run(): Promise<void> {
  const cpuStart = process.cpuUsage()
  for (let i = 0; !stopped; i++) {
    const item = order[i % order.length]!
    const input = await readFile(itemPath(dataset, item))
    const started = performance.now()
    await processItem(input, preset)
    completions.push({ file: item.file, at: Date.now(), wallMs: performance.now() - started })
  }
  const cpu = process.cpuUsage(cpuStart)
  process.send!({ type: 'done', completions, cpuMs: (cpu.user + cpu.system) / 1000, peakRssMb: peakRssMb() }, () =>
    process.exit(0),
  )
}

process.on('message', (message: { type: string }) => {
  if (message.type === 'go') void run()
  if (message.type === 'stop') stopped = true
})
process.send!({ type: 'ready', rssMb: rssMb() })
