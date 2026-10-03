import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { configureSharp, presetByName, processItem } from '@poof/imaging'
import { itemPath, loadDataset, shuffled } from './dataset.ts'
import { peakRssMb, rssMb } from './memory.ts'

const { values } = parseArgs({
  options: {
    data: { type: 'string', default: 'data/synthetic' },
    preset: { type: 'string', default: 'webp-1600' },
    seed: { type: 'string', default: '1' },
    write: { type: 'boolean', default: false },
  },
})

configureSharp()
const preset = presetByName(values.preset!)
const dataset = await loadDataset(values.data!)
const order = shuffled(dataset.items, Number(values.seed))
const completions: Array<{ file: string; at: number; wallMs: number }> = []
let stopped = false
const outDir = join(tmpdir(), `b2-out-${process.pid}`)
if (values.write) await mkdir(outDir, { recursive: true })

async function run(): Promise<void> {
  const cpuStart = process.cpuUsage()
  for (let i = 0; !stopped; i++) {
    const item = order[i % order.length]!
    const input = await readFile(itemPath(dataset, item))
    const started = performance.now()
    const output = await processItem(input, preset)
    if (values.write) {
      const target = join(outDir, `${i % 50}.${preset.ext}`)
      await writeFile(`${target}.tmp`, output)
      await rename(`${target}.tmp`, target)
    }
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
