import type { BreakerState } from './types.ts'

const outcomeWindow = 20
const minSamples = 10
const failureRatio = 0.5
const openMs = 30_000

export class Breaker {
  private outcomes: boolean[] = []
  private current: BreakerState = 'closed'
  private openedAt = 0
  private probing = false
  opened = 0

  state(now: number): BreakerState {
    if (this.current === 'open' && now - this.openedAt >= openMs) {
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
    if (this.outcomes.length > outcomeWindow) this.outcomes.shift()
    const failures = this.outcomes.filter(Boolean).length
    if (this.outcomes.length >= minSamples && failures / this.outcomes.length > failureRatio) {
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

export class Breakers<Type extends string> {
  private readonly byType = new Map<Type, Breaker>()

  get(type: Type): Breaker {
    let breaker = this.byType.get(type)
    if (!breaker) {
      breaker = new Breaker()
      this.byType.set(type, breaker)
    }
    return breaker
  }

  states(now: number): Map<Type, BreakerState> {
    return new Map([...this.byType].map(([type, breaker]) => [type, breaker.state(now)]))
  }
}
