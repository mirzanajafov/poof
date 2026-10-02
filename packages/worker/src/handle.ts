import { fork, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Assignment, FromWorker, ItemDead, ItemDone, LeaseDone, Shrunk } from './protocol.ts'

export interface Limits {
  rssMb: number
  heartbeatMs: number
  missedBeats: number
  killGraceMs: number
  watchMs: number
}

export const defaultLimits: Limits = { rssMb: 512, heartbeatMs: 1000, missedBeats: 3, killGraceMs: 2000, watchMs: 200 }

export type ExitReason = 'normal' | 'crash' | 'memory' | 'timeout' | 'heartbeat' | 'killed'

export interface Inflight {
  lease: string
  item: number
  since: number
}

export interface WorkerExit {
  reason: ExitReason
  code: number | null
  signal: NodeJS.Signals | null
  inflight: Inflight | null
  stderr: string
}

export interface HandleEvents {
  item: [ItemDone | ItemDead]
  leaseDone: [LeaseDone]
  exit: [WorkerExit]
}

interface Tracked {
  lease: string
  cursor: number
  hi: number
  itemTimeoutMs: number
}

const ownDir = new URL('.', import.meta.url)
const fromSource = import.meta.url.endsWith('.ts')
const defaultEntry = fileURLToPath(new URL(fromSource ? 'worker.ts' : 'worker.js', ownDir))
const defaultExecArgv = fromSource ? ['--conditions=source', '--disable-warning=ExperimentalWarning'] : []

function linuxRssMb(pid: number): number | null {
  if (process.platform !== 'linux') return null
  try {
    const match = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))
    return match ? Number(match[1]) / 1024 : null
  } catch {
    return null
  }
}

export class WorkerHandle extends EventEmitter<HandleEvents> {
  readonly limits: Limits
  private readonly entry: string
  private readonly execArgv: string[]
  private child: ChildProcess | null = null
  private readonly leases: Tracked[] = []
  private since = 0
  private lastBeat = 0
  private reportedRssMb = 0
  private killReason: ExitReason | null = null
  private stopping = false
  private watchdog: NodeJS.Timeout | null = null
  private stderr = ''
  private readonly pendingShrinks = new Map<string, (result: Shrunk) => void>()
  pid = 0

  constructor(options: { limits?: Partial<Limits>; entry?: string; execArgv?: string[] } = {}) {
    super()
    this.limits = { ...defaultLimits, ...options.limits }
    this.entry = options.entry ?? defaultEntry
    this.execArgv = options.execArgv ?? defaultExecArgv
  }

  get inflight(): Inflight | null {
    const lease = this.leases[0]
    if (!lease || lease.cursor >= lease.hi) return null
    return { lease: lease.lease, item: lease.cursor, since: this.since }
  }

  get rssMb(): number {
    return linuxRssMb(this.pid) ?? this.reportedRssMb
  }

  get idle(): boolean {
    return this.leases.length === 0
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = fork(this.entry, [], {
        execArgv: this.execArgv,
        env: { MALLOC_ARENA_MAX: '2', ...process.env, POOF_HEARTBEAT_MS: String(this.limits.heartbeatMs) },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      })
      this.child = child
      this.pid = child.pid ?? 0
      child.stderr!.on('data', (chunk: Buffer) => {
        this.stderr = (this.stderr + chunk.toString()).slice(-4096)
      })
      const onEarlyExit = (code: number | null) => reject(new Error(`worker exited with ${code} before ready: ${this.stderr}`))
      child.once('exit', onEarlyExit)
      child.on('message', (message: FromWorker) => {
        if (message.type === 'ready') {
          child.off('exit', onEarlyExit)
          child.once('exit', (code, signal) => this.onExit(code, signal))
          this.lastBeat = Date.now()
          this.reportedRssMb = message.rssMb
          this.watchdog = setInterval(() => this.watch(), this.limits.watchMs)
          resolve()
        } else {
          this.onMessage(message)
        }
      })
    })
  }

  assign(assignment: Omit<Assignment, 'type'>, itemTimeoutMs: number): void {
    if (this.leases.length === 0) this.since = Date.now()
    this.leases.push({ lease: assignment.lease, cursor: assignment.lo, hi: assignment.hi, itemTimeoutMs })
    this.child!.send({ type: 'assign', ...assignment })
  }

  shrink(lease: string, cut: number): Promise<Shrunk> {
    return new Promise((resolve) => {
      this.pendingShrinks.set(lease, resolve)
      this.child!.send({ type: 'shrink', lease, cut })
    })
  }

  stop(): void {
    this.stopping = true
    this.child?.send({ type: 'stop' })
  }

  kill(reason: ExitReason = 'killed'): void {
    if (!this.child || this.killReason) return
    this.killReason = reason
    this.child.kill('SIGTERM')
    setTimeout(() => this.child?.kill('SIGKILL'), this.limits.killGraceMs).unref()
  }

  private onMessage(message: FromWorker): void {
    if (message.type === 'beat') {
      this.lastBeat = Date.now()
      this.reportedRssMb = message.rssMb
    } else if (message.type === 'item') {
      const lease = this.leases[0]
      if (lease && lease.lease === message.lease) lease.cursor = message.item + 1
      this.since = Date.now()
      this.lastBeat = Date.now()
      this.emit('item', message)
    } else if (message.type === 'leaseDone') {
      this.leases.shift()
      this.since = Date.now()
      this.emit('leaseDone', message)
    } else if (message.type === 'shrunk') {
      const tracked = this.leases.find((l) => l.lease === message.lease)
      if (tracked && message.ok) tracked.hi = message.cut
      this.pendingShrinks.get(message.lease)?.(message)
      this.pendingShrinks.delete(message.lease)
    }
  }

  private watch(): void {
    const now = Date.now()
    if (this.rssMb > this.limits.rssMb) return this.kill('memory')
    const lease = this.leases[0]
    if (lease && lease.cursor < lease.hi && now - this.since > lease.itemTimeoutMs) return this.kill('timeout')
    if (now - this.lastBeat > this.limits.missedBeats * this.limits.heartbeatMs) return this.kill('heartbeat')
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.watchdog) clearInterval(this.watchdog)
    const reason: ExitReason = this.killReason ?? (code === 0 && this.stopping ? 'normal' : 'crash')
    for (const [lease, resolve] of this.pendingShrinks) resolve({ type: 'shrunk', lease, cut: -1, ok: false, next: -1 })
    this.pendingShrinks.clear()
    this.emit('exit', { reason, code, signal, inflight: this.inflight, stderr: this.stderr })
    this.child = null
  }
}
