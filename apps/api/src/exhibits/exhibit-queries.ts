import { Injectable } from '@nestjs/common'
import { Database } from '@poof/nest'

@Injectable()
export class ExhibitQueries {
  constructor(private readonly db: Database) {}

  list() {
    return this.db.client.exhibit.findMany({ orderBy: { startedAt: 'desc' }, take: 20 })
  }

  detail(id: string) {
    return this.db.client.exhibit.findUnique({
      where: { id },
      include: {
        tasks: {
          orderBy: { submittedAt: 'asc' },
          select: {
            id: true,
            status: true,
            items: true,
            done: true,
            submittedAt: true,
            deadline: true,
            finishedAt: true,
          },
        },
      },
    })
  }
}
