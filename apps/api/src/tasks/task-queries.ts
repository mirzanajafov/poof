import { Injectable } from '@nestjs/common'
import type { TaskStatus } from '@poof/db'
import { Database } from '@poof/nest'

@Injectable()
export class TaskQueries {
  constructor(private readonly db: Database) {}

  list(status: TaskStatus | undefined, limit: number) {
    return this.db.client.task.findMany({
      where: status ? { status } : {},
      orderBy: { submittedAt: 'desc' },
      take: limit,
    })
  }

  async detail(id: string) {
    const task = await this.db.client.task.findUnique({
      where: { id },
      include: {
        leases: { orderBy: [{ depth: 'asc' }, { lo: 'asc' }] },
        deadLetters: { orderBy: { item: 'asc' } },
        decisions: { orderBy: { at: 'asc' }, take: 200 },
      },
    })
    return task && { ...task, decisions: task.decisions.map((d) => ({ ...d, id: d.id.toString() })) }
  }
}
