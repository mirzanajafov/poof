import { Module } from '@nestjs/common'
import { DatasetsController } from './datasets.controller.js'
import { Datasets } from './datasets.service.js'

@Module({ controllers: [DatasetsController], providers: [Datasets] })
export class DatasetsModule {}
