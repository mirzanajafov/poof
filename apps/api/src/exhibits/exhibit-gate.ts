import { Injectable } from '@nestjs/common'
import { Env } from '../config/env.js'
import { Cache } from '../infra/cache.js'

const cooldownKey = 'poof:exhibit-cooldown'

export type Admission =
  | { kind: 'admitted'; giveBack(): Promise<void> }
  | { kind: 'too-long'; limitSeconds: number }
  | { kind: 'cooling-down'; retryAfterSeconds: number }

@Injectable()
export class ExhibitGate {
  constructor(
    private readonly cache: Cache,
    private readonly env: Env,
  ) {}

  async enter(durationSeconds: number): Promise<Admission> {
    const limitSeconds = this.env.PUBLIC_EXHIBIT_SECONDS
    if (durationSeconds > limitSeconds) return { kind: 'too-long', limitSeconds }
    const cooldownSeconds = this.env.EXHIBIT_COOLDOWN_SECONDS
    if (cooldownSeconds === 0) return { kind: 'admitted', giveBack: () => Promise.resolve() }
    if (await this.cache.claim(cooldownKey, cooldownSeconds + durationSeconds)) {
      return { kind: 'admitted', giveBack: () => this.cache.release(cooldownKey) }
    }
    return { kind: 'cooling-down', retryAfterSeconds: Math.max(1, await this.cache.ttl(cooldownKey)) }
  }
}
