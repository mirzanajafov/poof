import 'reflect-metadata'
import { ConsoleLogger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule, configureApp } from './app.module.js'
import { Env } from './config/env.js'

const logger = new ConsoleLogger({ json: process.env.LOG_JSON === 'true' })
const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule, { logger }))
await app.listen(app.get(Env).PORT, '0.0.0.0')
