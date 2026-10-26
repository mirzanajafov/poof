import { Logger, type OnApplicationShutdown } from '@nestjs/common'
import { createPrisma, type PrismaClient } from '@poof/db'

export class Database implements OnApplicationShutdown {
  readonly client: PrismaClient

  constructor(url: string) {
    this.client = createPrisma(url)
  }

  ping(): Promise<boolean> {
    return this.client.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    )
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect().catch((error: unknown) => {
      new Logger(Database.name).warn('could not disconnect from Postgres cleanly', error)
    })
  }
}
