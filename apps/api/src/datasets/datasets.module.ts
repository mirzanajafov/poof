import { Module } from '@nestjs/common'
import { DatasetsController } from './datasets.controller.js'

@Module({ controllers: [DatasetsController] })
export class DatasetsModule {}
