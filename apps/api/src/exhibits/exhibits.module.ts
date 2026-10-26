import { Module } from '@nestjs/common'
import { AccessModule } from '../access/access.module.js'
import { SupervisorModule } from '../supervisor/supervisor.module.js'
import { ExhibitsController } from './exhibits.controller.js'

@Module({ imports: [AccessModule, SupervisorModule], controllers: [ExhibitsController] })
export class ExhibitsModule {}
