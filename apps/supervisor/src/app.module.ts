import { Module } from '@nestjs/common'
import { EnvModule } from '@poof/nest'
import { Env } from './config/env.js'
import { DatasetsModule } from './datasets/datasets.module.js'
import { ExhibitsModule } from './exhibits/exhibits.module.js'
import { InfraModule } from './infra/infra.module.js'
import { SchedulerModule } from './scheduler/scheduler.module.js'
import { TasksModule } from './tasks/tasks.module.js'

@Module({
  imports: [EnvModule.forRoot(Env), InfraModule, DatasetsModule, TasksModule, SchedulerModule, ExhibitsModule],
})
export class AppModule {}
