import { ValidationPipe, type INestApplication } from '@nestjs/common'

export function applyDefaults<T extends INestApplication>(app: T): T {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  app.enableShutdownHooks()
  return app
}
