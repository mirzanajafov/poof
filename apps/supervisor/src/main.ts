import 'reflect-metadata'
import { ConsoleLogger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { AppModule, configureApp } from './app.module.js'
import type { Env } from './config/env.js'

const logger = new ConsoleLogger({ json: process.env.LOG_JSON === 'true' })
const app = configureApp(await NestFactory.create(AppModule.register(), { logger }))
await app.listen(app.get(ConfigService<Env, true>).get('PORT', { infer: true }), '0.0.0.0')
