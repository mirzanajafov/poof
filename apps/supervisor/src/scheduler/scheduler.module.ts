import { Module } from '@nestjs/common'
import { DatasetsModule } from '../datasets/datasets.module.js'
import { TasksModule } from '../tasks/tasks.module.js'
import { SchedulerController } from './scheduler.controller.js'
import { Scheduler } from './scheduler.service.js'

@Module({
  imports: [DatasetsModule, TasksModule],
  controllers: [SchedulerController],
  providers: [Scheduler],
  exports: [Scheduler],
})
export class SchedulerModule {}
