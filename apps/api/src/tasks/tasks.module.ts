import { Module } from '@nestjs/common'
import { AccessModule } from '../access/access.module.js'
import { SupervisorModule } from '../supervisor/supervisor.module.js'
import { OutputFiles } from './output-files.js'
import { TaskQueries } from './task-queries.js'
import { TasksController } from './tasks.controller.js'

@Module({
  imports: [AccessModule, SupervisorModule],
  controllers: [TasksController],
  providers: [TaskQueries, OutputFiles],
})
export class TasksModule {}
