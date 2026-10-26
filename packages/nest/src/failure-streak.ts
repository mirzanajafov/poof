import type { Logger } from '@nestjs/common'

export class FailureStreak {
  private readonly logger: Logger
  private readonly what: string
  private failing = false

  constructor(logger: Logger, what: string) {
    this.logger = logger
    this.what = what
  }

  failed(error: unknown): void {
    if (!this.failing) this.logger.warn(`${this.what} failed`, error)
    this.failing = true
  }

  succeeded(): void {
    if (this.failing) this.logger.log(`${this.what} works again`)
    this.failing = false
  }
}
