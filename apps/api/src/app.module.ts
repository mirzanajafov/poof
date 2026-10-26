import { Module } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { applyDefaults } from '@poof/nest'
import { ConfigModule } from './config/config.module.js'
import { Env } from './config/env.js'
import { DatasetsModule } from './datasets/datasets.module.js'
import { ExhibitsModule } from './exhibits/exhibits.module.js'
import { InfraModule } from './infra/infra.module.js'
import { LiveAdapter } from './live/live.adapter.js'
import { LiveModule } from './live/live.module.js'
import { TasksModule } from './tasks/tasks.module.js'

@Module({ imports: [ConfigModule, InfraModule, TasksModule, ExhibitsModule, DatasetsModule, LiveModule] })
export class AppModule {}

export function configureApp(app: NestExpressApplication): NestExpressApplication {
  const env = app.get(Env)
  app.set('trust proxy', env.TRUST_PROXY === 'false' ? false : env.TRUST_PROXY.split(','))
  app.setGlobalPrefix('api')
  app.enableCors({ origin: env.WEB_ORIGIN })
  app.useWebSocketAdapter(new LiveAdapter(app, env.WEB_ORIGIN))
  return applyDefaults(app)
}
