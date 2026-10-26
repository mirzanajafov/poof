import { Module } from '@nestjs/common'
import { Supervisor } from './supervisor.client.js'

@Module({ providers: [Supervisor], exports: [Supervisor] })
export class SupervisorModule {}
