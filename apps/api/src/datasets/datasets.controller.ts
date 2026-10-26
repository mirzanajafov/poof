import { Controller, Get } from '@nestjs/common'
import type { DatasetSummary } from '@poof/contracts'
import { Datasets } from './datasets.service.js'

@Controller('datasets')
export class DatasetsController {
  constructor(private readonly datasets: Datasets) {}

  @Get()
  list(): Promise<DatasetSummary[]> {
    return this.datasets.list()
  }
}
