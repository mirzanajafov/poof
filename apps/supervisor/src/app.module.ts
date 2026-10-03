import { Module, ValidationPipe, type DynamicModule, type INestApplication } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { validateEnv } from './config/env.js'
import { Datasets } from './datasets/datasets.service.js'
import { ExhibitsController } from './exhibits/exhibits.controller.js'
import { Exhibits } from './exhibits/exhibits.service.js'
import { InfraModule } from './infra/infra.module.js'
import { Scheduler } from './scheduler/scheduler.service.js'
import { TasksController } from './tasks/tasks.controller.js'

@Module({})
export class AppModule {
  static register(): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, ignoreEnvFile: true }), InfraModule],
      controllers: [TasksController, ExhibitsController],
      providers: [Datasets, Scheduler, Exhibits],
    }
  }
}

export function configureApp<T extends INestApplication>(app: T): T {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  app.enableShutdownHooks()
  return app
}
