import 'reflect-metadata'
import { ConsoleLogger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { enableValidationAndShutdownHooks } from '@poof/nest'
import { AppModule } from './app.module.js'
import { Env } from './config/env.js'

const logger = new ConsoleLogger({ json: process.env.LOG_JSON === 'true' })
const app = enableValidationAndShutdownHooks(await NestFactory.create(AppModule, { logger }))
await app.listen(app.get(Env).PORT, '0.0.0.0')
