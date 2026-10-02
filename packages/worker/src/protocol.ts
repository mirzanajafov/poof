import type { PresetName } from '@poof/imaging'

export interface Assignment {
  type: 'assign'
  lease: string
  task: string
  taskDir: string
  preset: PresetName
  lo: number
  hi: number
  maxAttempts: number
}

export interface Shrink {
  type: 'shrink'
  lease: string
  cut: number
}

export interface Stop {
  type: 'stop'
}

export type ToWorker = Assignment | Shrink | Stop

export interface Ready {
  type: 'ready'
  pid: number
  rssMb: number
}

export interface Beat {
  type: 'beat'
  rssMb: number
}

export interface ItemDone {
  type: 'item'
  lease: string
  item: number
  ok: true
  wallMs: number
  cpuMs: number
  outBytes: number
}

export interface ItemDead {
  type: 'item'
  lease: string
  item: number
  ok: false
  attempts: number
  error: string
}

export interface Shrunk {
  type: 'shrunk'
  lease: string
  cut: number
  ok: boolean
  next: number
}

export interface LeaseDone {
  type: 'leaseDone'
  lease: string
  hi: number
}

export type FromWorker = Ready | Beat | ItemDone | ItemDead | Shrunk | LeaseDone

export interface ManifestItem {
  file: string
}

export interface Manifest {
  items: ManifestItem[]
}
