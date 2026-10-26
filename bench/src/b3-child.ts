import { readFileSync } from 'node:fs'
import { rssMb } from './memory.ts'

const started = performance.now()
if (!process.send) throw new Error('b3-child runs only as a child process with an IPC channel')
const send = process.send.bind(process)
const { configureSharp, presets, processItem } = await import('@poof/imaging')
const { default: sharp } = await import('sharp')
configureSharp()
const tiny = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#888' } })
  .jpeg()
  .toBuffer()
await processItem(tiny, presets['webp-1600'])
const cpu = process.cpuUsage()
send({
  type: 'ready',
  sinceStartMs: performance.now(),
  importMs: performance.now() - started,
  cpuMs: (cpu.user + cpu.system) / 1000,
  rssMb: rssMb(),
  anonMb: anonMb(),
})

function anonMb(): number | null {
  if (process.platform !== 'linux') return null
  const match = /RssAnon:\s+(\d+) kB/.exec(readFileSync('/proc/self/status', 'utf8'))
  return match ? Number(match[1]) / 1024 : null
}
process.on('message', () => process.exit(0))
