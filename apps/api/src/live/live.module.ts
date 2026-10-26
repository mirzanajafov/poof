import { Module } from '@nestjs/common'
import { LiveController } from './live.controller.js'
import { LiveGateway } from './live.gateway.js'

@Module({ controllers: [LiveController], providers: [LiveGateway] })
export class LiveModule {}
