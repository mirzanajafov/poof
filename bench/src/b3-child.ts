import { rssMb } from './memory.ts'

const started = performance.now()
const { configureSharp, presets, processItem } = await import('@poof/imaging')
const { default: sharp } = await import('sharp')
configureSharp()
const tiny = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#888' } }).jpeg().toBuffer()
await processItem(tiny, presets['webp-1600'])
const cpu = process.cpuUsage()
process.send!({
  type: 'ready',
  sinceStartMs: performance.now(),
  importMs: performance.now() - started,
  cpuMs: (cpu.user + cpu.system) / 1000,
  rssMb: rssMb(),
})
process.on('message', () => process.exit(0))
