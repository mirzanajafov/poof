import type { BreakerState } from './types.ts'

export interface BreakerConfig {
  window: number
  minSamples: number
  failureRatio: number
  openMs: number
}

export const defaultBreakerConfig: BreakerConfig = { window: 20, minSamples: 10, failureRatio: 0.5, openMs: 30_000 }

export class Breaker {
  readonly config: BreakerConfig
  private outcomes: boolean[] = []
  private current: BreakerState = 'closed'
  private openedAt = 0
  private probing = false
  opened = 0

  constructor(config: BreakerConfig = defaultBreakerConfig) {
    this.config = config
  }

  state(now: number): BreakerState {
    if (this.current === 'open' && now - this.openedAt >= this.config.openMs) {
      this.current = 'half-open'
      this.probing = false
    }
    return this.current
  }

  record(ok: boolean, now: number): void {
    const state = this.state(now)
    if (state === 'open') return
    if (state === 'half-open') {
      if (ok) this.close()
      else this.open(now)
      return
    }
    this.outcomes.push(!ok)
    if (this.outcomes.length > this.config.window) this.outcomes.shift()
    const failures = this.outcomes.filter(Boolean).length
    if (this.outcomes.length >= this.config.minSamples && failures / this.outcomes.length > this.config.failureRatio) {
      this.open(now)
    }
  }

  allows(now: number): boolean {
    const state = this.state(now)
    if (state === 'closed') return true
    if (state === 'half-open' && !this.probing) {
      this.probing = true
      return true
    }
    return false
  }

  private open(now: number): void {
    this.current = 'open'
    this.openedAt = now
    this.outcomes = []
    this.probing = false
    this.opened++
  }

  private close(): void {
    this.current = 'closed'
    this.outcomes = []
    this.probing = false
  }
}
