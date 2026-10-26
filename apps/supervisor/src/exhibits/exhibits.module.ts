import { Module } from '@nestjs/common'
import { DatasetsModule } from '../datasets/datasets.module.js'
import { SchedulerModule } from '../scheduler/scheduler.module.js'
import { TasksModule } from '../tasks/tasks.module.js'
import { ExhibitsController } from './exhibits.controller.js'
import { Exhibits } from './exhibits.service.js'

@Module({
  imports: [DatasetsModule, TasksModule, SchedulerModule],
  controllers: [ExhibitsController],
  providers: [Exhibits],
})
export class ExhibitsModule {}
