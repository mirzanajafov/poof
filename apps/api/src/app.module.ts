import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { DomainErrorFilter, enableValidationAndShutdownHooks, EnvModule } from '@poof/nest'
import { Env } from './config/env.js'
import { DatasetsModule } from './datasets/datasets.module.js'
import { ExhibitsModule } from './exhibits/exhibits.module.js'
import { HealthModule } from './health/health.module.js'
import { InfraModule } from './infra/infra.module.js'
import { LiveAdapter } from './live/live.adapter.js'
import { LiveModule } from './live/live.module.js'
import { TasksModule } from './tasks/tasks.module.js'

@Module({
  imports: [EnvModule.forRoot(Env), InfraModule, TasksModule, ExhibitsModule, DatasetsModule, LiveModule, HealthModule],
  providers: [{ provide: APP_FILTER, useClass: DomainErrorFilter }],
})
export class AppModule {}

export function configureApp(app: NestExpressApplication): NestExpressApplication {
  const env = app.get(Env)
  app.set('trust proxy', env.TRUST_PROXY)
  app.setGlobalPrefix('api')
  app.enableCors({ origin: env.WEB_ORIGIN })
  app.useWebSocketAdapter(new LiveAdapter(app, env.WEB_ORIGIN))
  return enableValidationAndShutdownHooks(app)
}
