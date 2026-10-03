export function hashSeed(...parts: Array<string | number>): number {
  let hash = 0x811c9dc5
  for (const char of parts.join('|')) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  static of(...parts: Array<string | number>): Rng {
    return new Rng(hashSeed(...parts))
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next()
  }

  logUniform(lo: number, hi: number): number {
    return Math.exp(this.uniform(Math.log(lo), Math.log(hi)))
  }

  int(lo: number, hi: number): number {
    return Math.floor(this.uniform(lo, hi + 1))
  }

  normal(): number {
    const u = 1 - this.next()
    const v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  exponential(rate: number): number {
    return -Math.log(1 - this.next()) / rate
  }

  weighted<T>(options: ReadonlyArray<{ weight: number; value: T }>): T {
    const total = options.reduce((sum, o) => sum + o.weight, 0)
    let pick = this.next() * total
    for (const option of options) {
      pick -= option.weight
      if (pick < 0) return option.value
    }
    return options[options.length - 1]!.value
  }
}
