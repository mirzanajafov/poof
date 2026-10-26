import { Module } from '@nestjs/common'
import { Datasets } from './datasets.service.js'
import { Janitor } from './janitor.service.js'

@Module({ providers: [Datasets, Janitor], exports: [Datasets] })
export class DatasetsModule {}
