import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { configureSharp, presets, processItem } from '@poof/imaging'
import type { Assignment, FromWorker, ItemDead, ItemDone, Manifest, ToWorker } from './protocol.ts'

configureSharp()
if (process.platform === 'linux') await writeFile('/proc/self/oom_score_adj', '1000').catch(() => undefined)

interface Current {
  assignment: Assignment
  cursor: number
  hi: number
}

const heartbeatMs = Number(process.env.POOF_HEARTBEAT_MS ?? 1000)
const manifests = new Map<string, Manifest>()
const queue: Assignment[] = []
let current: Current | null = null
let running = false
let stopping = false

function rssMb(): number {
  return process.memoryUsage.rss() / 1024 / 1024
}

function send(message: FromWorker): Promise<void> {
  return new Promise((resolve) => process.send!(message, () => resolve()))
}

async function manifest(taskDir: string): Promise<Manifest> {
  let cached = manifests.get(taskDir)
  if (!cached) {
    cached = JSON.parse(await readFile(join(taskDir, 'manifest.json'), 'utf8')) as Manifest
    await mkdir(join(taskDir, 'out'), { recursive: true })
    manifests.set(taskDir, cached)
    if (manifests.size > 8) manifests.delete(manifests.keys().next().value!)
  }
  return cached
}

async function processOne(assignment: Assignment, item: number): Promise<ItemDone | ItemDead> {
  const preset = presets[assignment.preset]
  let error = ''
  for (let attempt = 1; attempt <= assignment.maxAttempts; attempt++) {
    try {
      const entry = (await manifest(assignment.taskDir)).items[item]
      if (!entry) throw new Error(`no item ${item} in the manifest`)
      const input = await readFile(join(assignment.taskDir, 'input', entry.file))
      const cpu = process.cpuUsage()
      const started = performance.now()
      const output = await processItem(input, preset)
      const wallMs = performance.now() - started
      const used = process.cpuUsage(cpu)
      const target = join(assignment.taskDir, 'out', `${item}.${preset.ext}`)
      const temp = `${target}.${process.pid}.tmp`
      await writeFile(temp, output)
      await rename(temp, target)
      return {
        type: 'item',
        lease: assignment.lease,
        item,
        ok: true,
        wallMs,
        cpuMs: (used.user + used.system) / 1000,
        outBytes: output.length,
      }
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure)
    }
  }
  return { type: 'item', lease: assignment.lease, item, ok: false, attempts: assignment.maxAttempts, error }
}

async function drain(): Promise<void> {
  if (running) return
  running = true
  while (queue.length > 0) {
    const assignment = queue.shift()!
    current = { assignment, cursor: assignment.lo, hi: assignment.hi }
    while (current.cursor < current.hi) {
      await send(await processOne(assignment, current.cursor))
      current.cursor++
    }
    await send({ type: 'leaseDone', lease: assignment.lease, hi: current.hi })
    current = null
  }
  running = false
  if (stopping) exit()
}

function shrink(lease: string, cut: number): void {
  if (current && current.assignment.lease === lease) {
    const ok = cut > current.cursor && cut < current.hi
    if (ok) current.hi = cut
    void send({ type: 'shrunk', lease, cut, ok, next: Math.min(current.cursor + 1, current.hi) })
    return
  }
  const queued = queue.find((a) => a.lease === lease)
  if (queued && cut >= queued.lo && cut < queued.hi) {
    queued.hi = cut
    void send({ type: 'shrunk', lease, cut, ok: true, next: queued.lo })
    return
  }
  void send({ type: 'shrunk', lease, cut, ok: false, next: -1 })
}

const beat = setInterval(() => void send({ type: 'beat', rssMb: rssMb() }), heartbeatMs)

function exit(): void {
  clearInterval(beat)
  process.disconnect()
}

process.on('disconnect', () => process.exit(0))
process.on('message', (message: ToWorker) => {
  if (message.type === 'assign') {
    queue.push(message)
    void drain()
  } else if (message.type === 'shrink') {
    shrink(message.lease, message.cut)
  } else if (message.type === 'stop') {
    stopping = true
    if (!running) exit()
  }
})

void send({ type: 'ready', pid: process.pid, rssMb: rssMb() })
