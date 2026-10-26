import { Module } from '@nestjs/common'
import { AccessModule } from '../access/access.module.js'
import { SupervisorModule } from '../supervisor/supervisor.module.js'
import { ExhibitGate } from './exhibit-gate.js'
import { ExhibitQueries } from './exhibit-queries.js'
import { ExhibitsController } from './exhibits.controller.js'

@Module({
  imports: [AccessModule, SupervisorModule],
  controllers: [ExhibitsController],
  providers: [ExhibitQueries, ExhibitGate],
})
export class ExhibitsModule {}
