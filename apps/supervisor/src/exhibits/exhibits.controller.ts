import { Body, Controller, Delete, Get, Headers, NotFoundException, Post } from '@nestjs/common'
import { extract } from '@poof/tracing'
import { Exhibits } from './exhibits.service.js'
import { StartExhibit } from './start-exhibit.dto.js'

@Controller('exhibits')
export class ExhibitsController {
  constructor(private readonly exhibits: Exhibits) {}

  @Post()
  start(@Body() body: StartExhibit, @Headers() headers: Record<string, string>) {
    return this.exhibits.start(body, extract(headers))
  }

  @Get('current')
  current() {
    const state = this.exhibits.state()
    if (!state) throw new NotFoundException('no exhibit is running')
    return state
  }

  @Delete('current')
  async abort() {
    const stats = await this.exhibits.finish('ABORTED')
    if (!stats) throw new NotFoundException('no exhibit is running')
    return stats
  }
}
