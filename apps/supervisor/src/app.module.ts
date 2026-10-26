import { Module } from '@nestjs/common'
import { ConfigModule } from './config/config.module.js'
import { DatasetsModule } from './datasets/datasets.module.js'
import { ExhibitsModule } from './exhibits/exhibits.module.js'
import { InfraModule } from './infra/infra.module.js'
import { SchedulerModule } from './scheduler/scheduler.module.js'
import { TasksModule } from './tasks/tasks.module.js'

@Module({ imports: [ConfigModule, InfraModule, DatasetsModule, TasksModule, SchedulerModule, ExhibitsModule] })
export class AppModule {}
