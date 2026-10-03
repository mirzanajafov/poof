import { Module, ValidationPipe, type DynamicModule, type INestApplication } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { type Env, validateEnv } from './config/env.js'
import { ExhibitsController } from './exhibits/exhibits.controller.js'
import { Admin, AdminGuard, RateLimitGuard } from './guards/guards.js'
import { InfraModule } from './infra/infra.module.js'
import { LiveGateway } from './live/live.gateway.js'
import { StateController } from './state/state.controller.js'
import { Supervisor } from './supervisor/supervisor.client.js'
import { TasksController } from './tasks/tasks.controller.js'

@Module({})
export class AppModule {
  static register(): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, ignoreEnvFile: true }), InfraModule],
      controllers: [TasksController, ExhibitsController, StateController],
      providers: [Supervisor, Admin, AdminGuard, RateLimitGuard, LiveGateway],
    }
  }
}

export function configureApp<T extends INestApplication>(app: T): T {
  const config = app.get(ConfigService<Env, true>)
  const trustProxy = config.get('TRUST_PROXY', { infer: true })
  ;(app as unknown as NestExpressApplication).set('trust proxy', trustProxy === 'false' ? false : trustProxy.split(','))
  app.setGlobalPrefix('api')
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }) })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  app.enableShutdownHooks()
  return app
}
