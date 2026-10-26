import type { OnApplicationShutdown } from '@nestjs/common'
import { createPrisma, type PrismaClient } from '@poof/db'

export class Database implements OnApplicationShutdown {
  readonly client: PrismaClient

  constructor(url: string) {
    this.client = createPrisma(url)
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect()
  }
}
